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

  const fitAndResize = (): void => {
    if (!terminal || !fitAddon || !props.isVisible) {
      return;
    }

    fitAddon.fit();
    void props.resizeTerminal(terminal.cols, terminal.rows);
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
      fontFamily: "var(--font-mono)",
      fontSize: 12,
      lineHeight: 1.35,
      scrollback: 5000,
    });
    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    if (hostRef) {
      terminal.open(hostRef);
    }

    const inputSubscription = terminal.onData((data) => {
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

    if (containerRef) {
      resizeObserver = new ResizeObserver(() => {
        scheduleFitAndResize();
      });
      resizeObserver.observe(containerRef);
    }

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
    if (props.isVisible && props.isReady) {
      scheduleFitAndResize();
    }
  });

  return (
    <section class="run-detail-terminal-shell" aria-label="Run terminal output">
      <div class="run-detail-terminal-root" ref={containerRef}>
        <div class="run-detail-terminal-host" ref={hostRef} />
      </div>
      <Show when={props.isStarting}>
        <p class="project-placeholder-text">Starting terminal...</p>
      </Show>
      <Show when={props.error.trim().length > 0}>
        <p class="projects-error">{props.error}</p>
      </Show>
    </section>
  );
};

export default RunTerminal;
