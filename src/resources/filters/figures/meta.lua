-- meta.lua
-- Copyright (C) 2020 by RStudio, PBC

-- inject metadata
function metaInject()
  return {
    Pandoc = function(doc)
      
      metaInjectLatex(doc, function(inject)
        inject(
          usePackage("caption") .. "\n" ..
          usePackage("subcaption")
        )
      end)
      
      metaInjectHtml(doc, function(inject)
        if figures.htmlPanels then
          inject([[
<style type="text/css">
  .quarto-figure figure {
    display: inline-block;
  }
  .quarto-subfigure-row {
    display: flex;
    align-items: flex-end;
  }
  .quarto-subfigure {
    position: relative;
  }
  .quarto-subfigure figure {
    margin: 0.2em;
  }
  .quarto-subfigure figcaption {
    text-align: center;
  }
  .quarto-subfigure div figure p {
    margin: 0;
  }
  .quarto-subfigure figcaption {
    font-size: 0.8em;
    font-style: italic;
  }
  figure > p:empty {
    display: none;
  }
  figure > p:first-child {
    margin-top: 0;
    margin-bottom: 0;
  }
</style>
]]
          )
        end
      end)
      
      return doc
    end
  }
end

