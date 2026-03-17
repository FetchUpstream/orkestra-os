import { Show, type Component } from "solid-js";
import NewRunChatWorkspace from "../components/NewRunChatWorkspace";
import { useRunDetailModel } from "../model/useRunDetailModel";

const NewRunDetailScreen: Component = () => {
  const model = useRunDetailModel();

  return (
    <div class="run-detail-page">
      <Show
        when={!model.error()}
        fallback={
          <section class="projects-panel run-detail-card">
            <p class="projects-error">{model.error()}</p>
          </section>
        }
      >
        <Show
          when={!model.isLoading()}
          fallback={
            <section class="projects-panel run-detail-card">
              <p class="project-placeholder-text">Loading run details.</p>
            </section>
          }
        >
          <Show
            when={model.run()}
            fallback={
              <section class="projects-panel run-detail-card">
                <p class="project-placeholder-text">Run not found.</p>
              </section>
            }
          >
            <NewRunChatWorkspace model={model} />
          </Show>
        </Show>
      </Show>
    </div>
  );
};

export default NewRunDetailScreen;
