/*
* book-render.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/

import { basename, dirname, join, relative } from "path/mod.ts";

import { encode as base64Encode } from "encoding/base64.ts";

import { ld } from "lodash/mod.ts";

import { inputFilesDir } from "../../../core/render.ts";

import { partitionMarkdown } from "../../../core/pandoc/pandoc-partition.ts";

import {
  kAbstract,
  kAuthor,
  kDate,
  kOutputExt,
  kOutputFile,
  kSubtitle,
  kTitle,
  kToc,
} from "../../../config/constants.ts";
import { Format, isHtmlOutput } from "../../../config/format.ts";

import {
  ExecutedFile,
  removePandocTo,
  RenderContext,
  renderContexts,
  RenderedFile,
  RenderOptions,
  renderPandoc,
} from "../../../command/render/render.ts";
import { outputRecipe } from "../../../command/render/output.ts";
import { renderCleanup } from "../../../command/render/cleanup.ts";

import { ProjectConfig, ProjectContext } from "../../project-context.ts";

import { BookExtension } from "./book-extension.ts";
import {
  bookConfig,
  BookConfigKey,
  BookItem,
  bookItems,
  isBookIndexPage,
} from "./book-config.ts";
import {
  chapterNumberForInput,
  withChapterTitleMetadata,
} from "./book-chapters.ts";

export function bookPandocRenderer(
  options: RenderOptions,
  project?: ProjectContext,
) {
  // accumulate executed files for all formats
  const files: Record<string, ExecutedFile[]> = {};

  // function to cleanup any files that haven't gone all the way
  // through the rendering pipeline
  const cleanupExecutedFiles = () => {
    for (const format of Object.keys(files)) {
      const executedFiles = files[format];
      executedFiles.forEach((executedFile) => {
        cleanupExecutedFile(
          executedFile,
          executedFile.recipe.output,
        );
      });
    }
  };

  return {
    onBeforeExecute: (format: Format) => {
      const extension = format.extensions?.book as BookExtension;
      return {
        // if we render a file at a time then resolve dependencies immediately
        resolveDependencies: !!extension.renderFile,
      };
    },

    onRender: (format: string, file: ExecutedFile) => {
      files[format] = files[format] || [];
      files[format].push(file);
      return Promise.resolve();
    },
    onComplete: async (error?: boolean) => {
      // rendered files to return. some formats need to end up returning all of the individual
      // renderedFiles (e.g. html or asciidoc) and some formats will consolidate all of their
      // files into a single one (e.g. pdf or epub)
      const renderedFiles: RenderedFile[] = [];

      // if there was an error during execution then cleanup any
      // executed files we've accumulated and return no rendered files
      if (error) {
        cleanupExecutedFiles();
        return {
          files: renderedFiles,
        };
      }

      try {
        const renderFormats = Object.keys(files);
        for (const renderFormat of renderFormats) {
          // get files
          const executedFiles = files[renderFormat];

          // determine the format from the first file
          if (executedFiles.length > 0) {
            const format = executedFiles[0].context.format;

            // get the book extension
            const extension = format.extensions?.book as BookExtension;

            // if it has a renderFile method then just do a file at a time
            if (extension.renderFile) {
              renderedFiles.push(
                ...(await renderMultiFileBook(
                  project!,
                  options,
                  extension,
                  executedFiles,
                )),
              );
              // otherwise render the entire book
            } else {
              renderedFiles.push(
                await renderSingleFileBook(
                  project!,
                  options,
                  extension,
                  executedFiles,
                ),
              );
            }
          }

          // remove the rendered files (indicating they have already been cleaned up)
          delete files[renderFormat];
        }

        return {
          files: renderedFiles,
        };
      } catch (error) {
        cleanupExecutedFiles();
        return {
          files: renderedFiles,
          error: error || new Error(),
        };
      }
    },
  };
}

export async function bookIncrementalRenderAll(
  context: ProjectContext,
  options: RenderOptions,
  files: string[],
) {
  for (let i = 0; i < files.length; i++) {
    // get contexts (formats)
    const contexts = await renderContexts(
      files[i],
      options,
      context,
    );

    // do any of them have a single-file book extension?
    for (const context of Object.values(contexts)) {
      const bookExtension = context.format.extensions?.book as
        | BookExtension
        | undefined;
      if (!bookExtension?.renderFile) {
        return true;
      }
    }
  }
  // no single-file book extensions found
  return false;
}

async function renderMultiFileBook(
  project: ProjectContext,
  _options: RenderOptions,
  extension: BookExtension,
  files: ExecutedFile[],
): Promise<RenderedFile[]> {
  const renderedFiles: RenderedFile[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const partitioned = partitionMarkdown(file.executeResult.markdown);
    const fileRelative = relative(project.dir, file.context.target.source);

    // index file
    if (isBookIndexPage(fileRelative)) {
      file.recipe.format = withBookTitleMetadata(
        file.recipe.format,
        project.config,
      );
      file.recipe.format.metadata[kToc] = false;
      // other files
    } else {
      // since this could be an incremental render we need to compute the chapter number
      const chapterNumber = isHtmlOutput(file.recipe.format.pandoc)
        ? await chapterNumberForInput(project, fileRelative)
        : 0;

      // provide title metadata
      if (partitioned.headingText) {
        file.recipe.format = withChapterTitleMetadata(
          file.recipe.format,
          partitioned,
          chapterNumber,
        );
      }

      // provide markdown
      file.executeResult.markdown = partitioned.markdown;
    }

    renderedFiles.push(await extension.renderFile!(file));
  }

  return renderedFiles;
}

async function renderSingleFileBook(
  project: ProjectContext,
  options: RenderOptions,
  _extension: BookExtension,
  files: ExecutedFile[],
): Promise<RenderedFile> {
  // we are going to compose a single ExecutedFile from the array we have been passed
  const executedFile = await mergeExecutedFiles(project, options, files);

  // set book title metadata
  executedFile.recipe.format = withBookTitleMetadata(
    executedFile.recipe.format,
    project.config,
  );

  // do pandoc render
  const renderedFile = await renderPandoc(executedFile);

  // cleanup step for each executed file
  files.forEach((file) => {
    cleanupExecutedFile(
      file,
      join(project.dir, renderedFile.file),
    );
  });

  // return rendered file
  return renderedFile;
}

function cleanupExecutedFile(
  file: ExecutedFile,
  finalOutput: string,
) {
  renderCleanup(
    file.context.target.input,
    finalOutput,
    file.recipe.format,
    // because we may have only rendered a single self-contained format (and used the
    // freezer), we want to cleanup all of the files_dir which may have been
    // copied from the freezer
    file.executeResult.supporting.length > 0
      ? [
        join(
          dirname(file.context.target.input),
          inputFilesDir(file.context.target.input),
        ),
      ]
      : [],
    file.context.engine.keepMd(file.context.target.input),
  );
}

async function mergeExecutedFiles(
  project: ProjectContext,
  options: RenderOptions,
  files: ExecutedFile[],
): Promise<ExecutedFile> {
  // base context on the first file
  const context = ld.cloneDeep(files[0].context) as RenderContext;

  // use global render options
  context.options = removePandocTo(options);

  // set output file based on book title
  const title = bookConfig(kTitle, project.config) || basename(project.dir);
  context.format.pandoc[kOutputFile] = `${title}.${
    context.format.render[kOutputExt]
  }`;

  // create output recipe (tweak output file)
  const recipe = await outputRecipe(context);

  // merge markdown, writing a metadata comment into each file
  const items = bookItems(project.dir, project.config);
  const markdown = items.reduce(
    (markdown: string, item: BookItem) => {
      // item markdown
      let itemMarkdown = "";

      // get executed file for book item
      if (item.file) {
        const itemInputPath = join(project.dir, item.file);
        const file = files.find((file) =>
          file.context.target.input === itemInputPath
        );
        if (file) {
          itemMarkdown = bookItemMetadata(project, item, file) +
            file.executeResult.markdown;
        } else {
          throw new Error(
            "Executed file not found for book item: " + item.file,
          );
        }
        // if there is no file then this must be a part
      } else if (item.type === "part" || item.type === "appendix") {
        itemMarkdown = bookPartMarkdown(project, item);
      }

      // if this is part divider, then surround it in a special div so we
      // can discard it in formats that don't support parts
      if (item.type === "part" && itemMarkdown.length > 0) {
        itemMarkdown = `\n\n::: {.quarto-book-part}\n${itemMarkdown}\n:::\n\n`;
      }

      // fallthrough
      return markdown + itemMarkdown;
    },
    "",
  );

  // merge supporting
  const supporting = files.reduce(
    (supporting: string[], file: ExecutedFile) => {
      return ld.uniq(
        supporting.concat(
          file.executeResult.supporting.map((f) => relative(project.dir, f)),
        ),
      );
    },
    [] as string[],
  );

  // merge filters
  const filters = ld.uniq(files.flatMap((file) => file.executeResult.filters));

  // merge dependencies
  const dependencies = files.reduce(
    (dependencies: Array<unknown>, file: ExecutedFile) => {
      return dependencies.concat(
        file.executeResult.dependencies?.data as Array<unknown> || [],
      );
    },
    new Array<unknown>(),
  );

  // merge preserves
  const preserve = files.reduce(
    (preserve: Record<string, string>, file: ExecutedFile) => {
      return {
        ...preserve,
        ...file.executeResult.preserve,
      };
    },
    {} as Record<string, string>,
  );

  return Promise.resolve({
    context,
    recipe,
    executeResult: {
      markdown,
      supporting,
      filters,
      dependencies: {
        type: "dependencies",
        data: dependencies,
      },
      preserve,
    },
  });
}

function bookItemMetadata(
  project: ProjectContext,
  item: BookItem,
  file?: ExecutedFile,
) {
  const resourceDir = file
    ? relative(project.dir, dirname(file.context.target.input))
    : undefined;
  const metadata = base64Encode(
    JSON.stringify({
      bookItemType: item.type,
      resourceDir: resourceDir || ".",
    }),
  );
  return `\n\n\`<!-- quarto-file-metadata: ${metadata} -->\`{=html}\n\n\`\`\`{=html}\n<!-- quarto-file-metadata: ${metadata} -->\n\`\`\`\n\n`;
}

function bookPartMarkdown(project: ProjectContext, item: BookItem) {
  const metadata = bookItemMetadata(project, item);
  return `${metadata}# ${item.text}\n\n`;
}

function withBookTitleMetadata(format: Format, config?: ProjectConfig): Format {
  format = ld.cloneDeep(format);
  if (config) {
    const setMetadata = (
      key: BookConfigKey,
    ) => {
      const value = bookConfig(key, config);
      if (value) {
        format.metadata[key] = value;
      }
    };
    setMetadata(kTitle);
    setMetadata(kSubtitle);
    setMetadata(kAuthor);
    setMetadata(kDate);
    setMetadata(kAbstract);
  }
  return format;
}
