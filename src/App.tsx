import { createSignal, onCleanup, onMount } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

function App() {
  const [message, setMessage] = createSignal("Checking backend...");
  const [status, setStatus] = createSignal("waiting");

  onMount(async () => {
    const unlisten = await listen<string>("app://runtime-status", (event) => {
      setStatus(event.payload);
    });

    try {
      const result = await invoke<string>("health_check");
      setMessage(result);
    } catch (error) {
      setMessage(`Error: ${String(error)}`);
    }

    onCleanup(() => {
      unlisten();
    });
  });

  return (
    <main class="min-h-screen space-y-3 bg-zinc-950 p-8 text-zinc-100">
      <h1 class="text-3xl font-semibold">OrkestraOS</h1>
      <p class="text-zinc-400">{message()}</p>
      <p class="text-zinc-500">Runtime status: {status()}</p>
      <button class="rounded-lg bg-zinc-800 px-4 py-2 hover:bg-zinc-700">
        Test button
      </button>
    </main>
  );
}

export default App;
