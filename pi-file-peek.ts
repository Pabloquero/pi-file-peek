import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPeekExtension } from "./src/runtime.js";

export default function piFilePeek(pi: ExtensionAPI) {
  return registerPeekExtension(pi);
}
