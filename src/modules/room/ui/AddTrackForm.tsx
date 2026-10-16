import { useState, type FormEvent } from "react";
import { offersPlaylistChoice } from "@/modules/catalog/ui/index.ts";
import type { LinkScope } from "@/modules/room/domain/ports/TrackSource.ts";
import { Icon } from "@/shared/ui/Icon.tsx";
import { PlaylistChoice } from "./PlaylistChoice.tsx";

export function AddTrackForm({
  onAdd,
}: {
  onAdd: (url: string, scope: LinkScope) => Promise<string>;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** A link naming a song inside a playlist, held back until its person says which they meant. */
  const [choosing, setChoosing] = useState<string | null>(null);
  const added = message?.startsWith("Added") ?? false;

  async function add(link: string, scope: LinkScope) {
    setChoosing(null);
    setBusy(true);
    setMessage(null);
    const reply = await onAdd(link, scope);
    setBusy(false);
    setMessage(reply);
    if (reply.startsWith("Added")) setUrl("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const link = url.trim();
    if (link === "" || busy) return;
    if (offersPlaylistChoice(link)) {
      setMessage(null);
      setChoosing(link);
    } else {
      void add(link, "song");
    }
  }

  return (
    <section className="add" aria-labelledby="add-heading">
      <h2 id="add-heading">Add songs</h2>
      <form className="add__form" onSubmit={submit}>
        <label className="add__label" htmlFor="add-url">
          YouTube video or playlist link
        </label>
        <div className="add__row">
          <input
            id="add-url"
            className="input add__input"
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://youtu.be/…"
            value={url}
            onChange={(event) => {
              setUrl(event.currentTarget.value);
              setChoosing(null);
            }}
          />
          <button
            type="submit"
            className="button button--primary"
            disabled={busy || url.trim() === ""}
          >
            {busy ? "Adding…" : "Add"}
          </button>
        </div>
      </form>
      {choosing !== null && <PlaylistChoice onChoose={(scope) => void add(choosing, scope)} />}
      <p className={added ? "add__result add__result--added" : "add__result"} role="status">
        {added && <Icon name="check" />}
        {message}
      </p>
    </section>
  );
}
