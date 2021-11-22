/*
* chunk-metadata.ts
*
* JSON Schema for Quarto's YAML chunk metadata
*
* Copyright (C) 2021 by RStudio, PBC
*
*/

import { YAMLSchema } from "./yaml-schema.ts";

import { Schema } from "../lib/schema.ts";

import {
  anyOfSchema as anyOfS,
  arraySchema as arrayS,
  BooleanSchema as BooleanS,
  enumSchema as enumS,
  NullSchema as NullS,
  numericSchema as numericS,
  objectSchema as objectS,
  oneOfSchema as oneOfS,
  StringSchema as StringS,
  idSchema as withId
} from "./common.ts";

import {
  kCellClasses,
  kCellFigAlign,
  kCellFigAlt,
  kCellFigCap,
  kCellFigEnv,
  kCellFigLink,
  kCellFigPos,
  kCellFigScap,
  kCellFigSubCap,
  kCellLabel,
  kCellLstCap,
  kCellLstLabel,
  kCellMdIndent,
  kCellPanel,
  kCodeFold,
  kCodeOverflow,
  kCodeSummary,
  kEcho,
  kError,
  kEval,
  kInclude,
  kLayoutNcol,
  kLayoutNrow,
  kOutput,
  kWarning,
} from "../../config/constants.ts";

const commonCellOptionsSchema = objectS({
  properties: {
    [kCellLabel]: StringS,
    [kCellFigCap]: anyOfS(StringS, arrayS(StringS)),
    [kCellFigSubCap]: arrayS(StringS),
    [kCellLstLabel]: StringS,
    [kCellLstCap]: StringS,
    [kCellClasses]: StringS,
    [kCellPanel]: StringS,
    [kCodeFold]: oneOfS(StringS, BooleanS), // FIXME tighten code-fold strings
    [kCodeSummary]: StringS,
    [kCodeOverflow]: StringS, // FIXME should this be enumS("wrap", "scroll")?

    [kCellFigScap]: StringS,
    [kCellFigLink]: StringS,
    [kCellFigAlign]: StringS,
    [kCellFigEnv]: StringS,
    [kCellFigPos]: StringS,
    [kCellFigAlt]: StringS,

    [kEval]: anyOfS(BooleanS, NullS),
    [kError]: BooleanS,
    [kEcho]: anyOfS(BooleanS, enumS("fenced")),
    [kOutput]: anyOfS(BooleanS, enumS("all", "asis")),
    [kInclude]: BooleanS,

    [kLayoutNcol]: numericS({
      "type": "integer",
      "minimum": 1,
    }),
    [kLayoutNrow]: numericS({
      "type": "integer",
      "minimum": 1,
    }),
  },
});

export const ojsCellOptionsSchema = withId(objectS({
  baseSchema: commonCellOptionsSchema,
  properties: {
    classes: arrayS(StringS),
  },
  description: "be an OJS cell options object",
}), "ojs");

export const jupyterCellOptionsSchema = withId(objectS({
  baseSchema: commonCellOptionsSchema,
  properties: {
    [kCellMdIndent]: StringS,
    [kWarning]: BooleanS,
  },
  description: "be a Jupyter cell options object",
}), "python");

export const rCellOptionsSchema = withId(commonCellOptionsSchema, "r");

export const languageOptionsSchema: Record<string, Schema> = {
  "ojs": ojsCellOptionsSchema,
  "python": jupyterCellOptionsSchema,
  "r": rCellOptionsSchema,
}
