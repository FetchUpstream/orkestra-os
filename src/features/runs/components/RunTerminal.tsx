import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  Show,
  createEffect,
  onCleanup,
  onMount,
  type Component,
} from "solid-js";
import type { RunTerminalFrame } from "../../../app/lib/runs";

type RunTerminalProps = {
  isVisible: boolean;
  isStarting: boolean;
  isReady: boolean;
  isInputEnabled: boolean;
  error: string;
  writeTerminal: (data: string) => Promise<void>;
  resizeTerminal: (cols: number, rows: number) => Promise<void>;
  setTerminalFrameHandler: (
    handler: ((frame: RunTerminalFrame) => void) | null,
  ) => void;
};

const decodeBase64Chunk = (chunkBase64: string): Uint8Array => {
  const binary = atob(chunkBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const RunTerminal: Component<RunTerminalProps> = (props) => {
  let containerRef: HTMLDivElement | undefined;
  let hostRef: HTMLDivElement | undefined;
  let terminal: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSentTerminalSize: { cols: number; rows: number } | null = null;

  const fitAndResize = (): void => {
    if (!terminal || !fitAddon || !props.isVisible) {
      return;
    }

    fitAddon.fit();
    const fittedCols = terminal.cols;
    const fittedRows = terminal.rows;
    if (
      lastSentTerminalSize &&
      lastSentTerminalSize.cols === fittedCols &&
      lastSentTerminalSize.rows === fittedRows
    ) {
      return;
    }

    lastSentTerminalSize = {
      cols: fittedCols,
      rows: fittedRows,
    };
    void props.resizeTerminal(fittedCols, fittedRows);
  };

  const scheduleFitAndResize = (): void => {
    if (resizeDebounceTimer) {
      clearTimeout(resizeDebounceTimer);
    }
    resizeDebounceTimer = setTimeout(() => {
      resizeDebounceTimer = null;
      fitAndResize();
    }, 120);
  };

  onMount(() => {
    terminal = new Terminal({
      cursorBlink: true,
      disableStdin: !props.isInputEnabled,
      fontSize: 13,
      lineHeight: 1.4,
      scrollback: 5000,
      theme: {
        background: "#0a1119",
        foreground: "#d7e4f6",
        cursor: "#8ac6ff",
        cursorAccent: "#0a1119",
        selectionBackground: "rgba(122, 175, 255, 0.24)",
      },
    });
    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    if (hostRef) {
      terminal.open(hostRef);
    }

    const inputSubscription = terminal.onData((data) => {
      if (!props.isInputEnabled) {
        return;
      }
      void props.writeTerminal(data);
    });

    props.setTerminalFrameHandler((frame) => {
      if (!terminal) {
        return;
      }

      if (frame.type === "data") {
        try {
          terminal.write(decodeBase64Chunk(frame.chunkBase64));
        } catch {
          terminal.writeln("\r\n[terminal stream decode error]\r");
        }
        return;
      }

      if (frame.type === "exit") {
        const codeLabel = frame.code === null ? "n/a" : String(frame.code);
        const signalLabel =
          frame.signal === null ? "n/a" : String(frame.signal);
        terminal.writeln(
          `\r\n[terminal exited: code=${codeLabel}, signal=${signalLabel}]\r`,
        );
        return;
      }

      if (frame.type === "error") {
        terminal.writeln(`\r\n[terminal error: ${frame.message}]\r`);
        return;
      }

      terminal.writeln("\r\n[terminal closed]\r");
    });

    if (containerRef && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        scheduleFitAndResize();
      });
      resizeObserver.observe(containerRef);
    }

    fitAndResize();
    scheduleFitAndResize();

    onCleanup(() => {
      props.setTerminalFrameHandler(null);
      inputSubscription.dispose();
      resizeObserver?.disconnect();
      if (resizeDebounceTimer) {
        clearTimeout(resizeDebounceTimer);
      }
      terminal?.dispose();
      terminal = null;
      fitAddon = null;
    });
  });

  createEffect(() => {
    if (terminal) {
      terminal.options.disableStdin = !props.isInputEnabled;
    }
  });

  createEffect(() => {
    if (props.isVisible && props.isReady) {
      scheduleFitAndResize();
    }
  });

  return (
    <section class="run-detail-terminal-shell" aria-label="Run terminal output">
      <div class="run-detail-terminal-root" ref={containerRef}>
        <div class="run-detail-terminal-host" ref={hostRef} />
      </div>
      <div class="run-detail-terminal-feedback">
        <Show when={props.isStarting}>
          <p class="run-detail-terminal-status">Starting terminal...</p>
        </Show>
        <Show when={props.error.trim().length > 0}>
          <p class="projects-error">{props.error}</p>
        </Show>
      </div>
    </section>
  );
};

export default RunTerminal;
