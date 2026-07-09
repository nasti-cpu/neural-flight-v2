export * from "./terrain";
export * from "./wasser";
export * from "./wasseroberfläche";
export * from "./chunks";

import * as terrain from "./terrain";
import * as wasser from "./wasser";
import * as wasseroberfläche from "./wasseroberfläche";
import * as chunks from "./chunks";

export const world = {
	terrain,
	wasser,
	wasseroberfläche,
	chunks,
};
