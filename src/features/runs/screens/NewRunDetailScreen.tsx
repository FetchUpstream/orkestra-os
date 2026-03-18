import { Show, type Component } from "solid-js";
import BackIconLink from "../../../components/ui/BackIconLink";
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
            <>
              <section class="run-chat-back-nav" aria-label="Run navigation">
                <BackIconLink
                  href={model.backHref()}
                  label={model.backLabel()}
                  class="project-detail-back-link project-detail-back-link--icon task-detail-back-link"
                />
              </section>
              <NewRunChatWorkspace model={model} />
            </>
          </Show>
        </Show>
      </Show>
    </div>
  );
};

export default NewRunDetailScreen;
