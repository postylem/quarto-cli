/*
* mermaid.ts
*
* Copyright (C) 2022 by RStudio, PBC
*
*/

import {
  LanguageCellHandlerContext,
  LanguageCellHandlerOptions,
  LanguageHandler,
} from "./types.ts";
import { baseHandler, install } from "./base.ts";
import { formatResourcePath } from "../resources.ts";
import { join } from "path/mod.ts";
import {
  isJavascriptCompatible,
  isMarkdownOutput,
  isRevealjsOutput,
} from "../../config/format.ts";
import { QuartoMdCell } from "../lib/break-quarto-md.ts";
import { asMappedString, mappedConcat } from "../lib/mapped-text.ts";
import {
  fixupAlignment,
  makeResponsive,
  resolveSize,
  setSvgSize,
} from "../svg.ts";
import {
  kFigAlign,
  kFigHeight,
  kFigResponsive,
  kFigWidth,
} from "../../config/constants.ts";
import { Element } from "../deno-dom.ts";

const mermaidHandler: LanguageHandler = {
  ...baseHandler,

  type: "cell",
  stage: "post-engine",

  languageName: "mermaid",
  languageClass: (options: LanguageCellHandlerOptions) => {
    if (isMarkdownOutput(options.format.pandoc, ["gfm"])) {
      return "mermaid-source"; // sidestep github's in-band signaling of mermaid diagrams
    } else {
      return "default"; // no pandoc highlighting yet so we use 'default' to get grey shading
    }
  },

  defaultOptions: {
    echo: false,
    eval: true,
    include: true,
  },

  comment: "%%",

  async cell(
    handlerContext: LanguageCellHandlerContext,
    cell: QuartoMdCell,
    options: Record<string, unknown>,
  ) {
    const cellContent = handlerContext.cellContent(cell);
    // create puppeteer target page
    const content = `<html>
    <head>
    <script src="./mermaid.min.js"></script>
    </head>
    <body>
    <pre class="mermaid">\n${cellContent.value}\n</pre>
    <script>
    mermaid.initialize();
    </script>
    </html>`;
    const selector = "pre.mermaid svg";
    const resources: [string, string][] = [[
      "mermaid.min.js",
      Deno.readTextFileSync(
        formatResourcePath("html", join("mermaid", "mermaid.min.js")),
      ),
    ]];

    if (isJavascriptCompatible(handlerContext.options.format)) {
      let svg = asMappedString(
        (await handlerContext.extractHtml({
          html: content,
          selector,
          resources,
        }))[0],
      );
      const responsive = handlerContext.options.context.format.metadata
        ?.[kFigResponsive];

      const fixupRevealAlignment = (svg: Element) => {
        if (isRevealjsOutput(handlerContext.options.context.format.pandoc)) {
          const align = (options?.[kFigAlign] as string) ?? "center";
          fixupAlignment(svg, align);
        }
      };

      const fixupMermaidSvg = (svg: Element) => {
        // replace mermaid id with a consistent one.
        const { baseName: newId } = handlerContext.uniqueFigureName(
          "mermaid-figure-",
          "",
        );
        fixupRevealAlignment(svg);
        const oldId = svg.getAttribute("id") as string;
        svg.setAttribute("id", newId);
        const style = svg.querySelector("style")!;
        style.innerHTML = style.innerHTML.replaceAll(oldId, newId);
      };

      if (
        responsive && options[kFigWidth] === undefined &&
        options[kFigHeight] === undefined
      ) {
        svg = await makeResponsive(svg, fixupMermaidSvg);
      } else {
        svg = await setSvgSize(svg, options, (svg: Element) => {
          // mermaid comes with too much styling wrt to max width. remove it.
          svg.removeAttribute("style");

          fixupMermaidSvg(svg);
        });
      }

      return this.build(
        handlerContext,
        cell,
        svg,
        options,
        undefined,
        new Set(["fig-width", "fig-height"]),
      );
    } else if (
      isMarkdownOutput(handlerContext.options.format.pandoc, ["gfm"])
    ) {
      return this.build(
        handlerContext,
        cell,
        mappedConcat(["\n``` mermaid\n", cellContent, "\n```\n"]),
        options,
        undefined,
        new Set(["fig-width", "fig-height"]),
      );
    } else {
      const {
        filenames: [sourceName],
        elements: [svgText],
      } = await handlerContext.createPngsFromHtml({
        prefix: "mermaid-figure-",
        selector,
        count: 1,
        deviceScaleFactor: Number(options.deviceScaleFactor) || 4,
        html: content,
        resources,
      });

      const {
        widthInInches,
        heightInInches,
      } = await resolveSize(svgText, options);

      return this.build(
        handlerContext,
        cell,
        mappedConcat([
          `\n![](${sourceName}){width="${widthInInches}in" height="${heightInInches}in" fig-pos='H'}\n`,
        ]),
        options,
        undefined,
        new Set(["fig-width", "fig-height"]),
      );
    }
  },
};

install(mermaidHandler);
