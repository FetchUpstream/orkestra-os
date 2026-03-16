import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

type MonacoEnvironmentWithWorker = {
  getWorker: (_moduleId: string, label: string) => Worker;
};

let isMonacoEnvironmentInitialized = false;

export const ensureMonacoEnvironment = () => {
  if (isMonacoEnvironmentInitialized) return;

  (
    self as typeof globalThis & {
      MonacoEnvironment?: MonacoEnvironmentWithWorker;
    }
  ).MonacoEnvironment = {
    getWorker(_moduleId, label) {
      if (label === "typescript" || label === "javascript") {
        return new TsWorker();
      }

      if (label === "json") {
        return new JsonWorker();
      }

      if (label === "html" || label === "handlebars" || label === "razor") {
        return new HtmlWorker();
      }

      if (label === "css" || label === "scss" || label === "less") {
        return new CssWorker();
      }

      return new EditorWorker();
    },
  };

  isMonacoEnvironmentInitialized = true;
};
