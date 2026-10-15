import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  addGuest,
  declineRequest,
  loadGuestList,
  removeGuest,
  setGuestAdmin,
  type AdminResult,
  type GuestList,
} from "./adminClient.ts";
import type { SessionUser } from "./sessionClient.ts";
import { SignOutButton } from "./SignOutButton.tsx";

const WHEN = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function When({ iso }: { iso: string }) {
  return <time dateTime={iso}>{WHEN.format(new Date(iso))}</time>;
}

function Avatar({ url }: { url: string }) {
  return <img className="person__avatar" src={url} alt="" width={40} height={40} />;
}

export function RequestList({
  requests,
  onApprove,
  onDecline,
}: {
  requests: GuestList["requests"];
  onApprove: (discordId: string) => void;
  onDecline: (discordId: string) => void;
}) {
  if (requests.length === 0) {
    return (
      <p className="admin__empty">
        Nobody is waiting. When a friend signs in with Discord, they show up here for you to
        approve.
      </p>
    );
  }
  return (
    <ul className="people">
      {requests.map((request) => (
        <li key={request.discordId} className="person">
          <Avatar url={request.avatarUrl} />
          <div className="person__text">
            <span className="person__name">{request.name}</span>
            <span className="person__meta">
              @{request.username}, asked <When iso={request.requestedAt} />
            </span>
          </div>
          <div className="person__actions">
            <button
              type="button"
              className="button button--primary"
              aria-label={`Approve ${request.name}`}
              onClick={() => onApprove(request.discordId)}
            >
              Approve
            </button>
            <button
              type="button"
              className="button"
              aria-label={`Decline ${request.name}`}
              onClick={() => onDecline(request.discordId)}
            >
              Decline
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Guests who are not admins: they can be made one, or removed. */
export function GuestRows({
  guests,
  onMakeAdmin,
  onRemove,
}: {
  guests: GuestList["guests"];
  onMakeAdmin: (discordId: string) => void;
  onRemove: (discordId: string) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);

  if (guests.length === 0) {
    return (
      <p className="admin__empty">
        No guests yet. Approve somebody above, or add them by their Discord user ID.
      </p>
    );
  }
  return (
    <ul className="people">
      {guests.map((guest) => (
        <li key={guest.discordId} className="person">
          <Avatar url={guest.avatarUrl} />
          <div className="person__text">
            <span className="person__name">{guest.name}</span>
            <span className="person__meta">
              {guest.label !== null && guest.label !== guest.name && `${guest.label}, `}
              added <When iso={guest.addedAt} />
              {!guest.hasSignedIn && ", not signed in yet"}
            </span>
          </div>
          <div className="person__actions">
            {confirming === guest.discordId ? (
              <>
                <span className="person__confirm">
                  Remove {guest.name}? They leave the room at once.
                </span>
                <button
                  type="button"
                  className="button button--danger"
                  onClick={() => {
                    setConfirming(null);
                    onRemove(guest.discordId);
                  }}
                >
                  Remove
                </button>
                <button type="button" className="button" onClick={() => setConfirming(null)}>
                  Keep
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="button"
                  aria-label={`Make ${guest.name} an admin`}
                  onClick={() => onMakeAdmin(guest.discordId)}
                >
                  Make admin
                </button>
                <button
                  type="button"
                  className="button"
                  aria-label={`Remove ${guest.name}`}
                  onClick={() => setConfirming(guest.discordId)}
                >
                  Remove
                </button>
              </>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function AddGuestForm({
  onAdd,
}: {
  /** Resolves to null when the guest was added, else the reason it was not. */
  onAdd: (discordId: string, label: string | null) => Promise<string | null>;
}) {
  const [discordId, setDiscordId] = useState("");
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    const refusal = await onAdd(discordId, label.trim() === "" ? null : label);
    setBusy(false);
    if (refusal === null) {
      setMessage(`Added. They can sign in now.`);
      setDiscordId("");
      setLabel("");
    } else {
      setMessage(refusal);
    }
  }

  return (
    <form className="add-guest" onSubmit={(event) => void submit(event)}>
      <div className="add-guest__field">
        <label htmlFor="guest-id">Discord user ID</label>
        <input
          id="guest-id"
          inputMode="numeric"
          autoComplete="off"
          aria-describedby="guest-id-hint"
          value={discordId}
          onChange={(event) => setDiscordId(event.currentTarget.value)}
        />
      </div>
      <div className="add-guest__field">
        <label htmlFor="guest-label">Name (optional)</label>
        <input
          id="guest-label"
          autoComplete="off"
          maxLength={80}
          value={label}
          onChange={(event) => setLabel(event.currentTarget.value)}
        />
      </div>
      <button
        type="submit"
        className="button button--primary"
        disabled={busy || discordId.trim() === ""}
      >
        {busy ? "Adding…" : "Add guest"}
      </button>
      <p id="guest-id-hint" className="add-guest__hint">
        In Discord, turn on Settings → Advanced → Developer Mode, then right-click them and choose
        Copy User ID.
      </p>
      <p className="add-guest__result" role="status">
        {message}
      </p>
    </form>
  );
}

/**
 * Everyone who may manage guests: the hosts, fixed on the server, and the
 * guests made admins here, who can be made plain guests again.
 */
export function AdminList({
  hosts,
  admins,
  onRemoveAdmin,
}: {
  hosts: GuestList["hosts"];
  admins: GuestList["guests"];
  onRemoveAdmin: (discordId: string) => void;
}) {
  return (
    <ul className="people">
      {hosts.map((host) => (
        <li key={host.discordId} className="person">
          <Avatar url={host.avatarUrl} />
          <div className="person__text">
            <span className="person__name">{host.name}</span>
            <span className="person__meta">Host, set on the server</span>
          </div>
        </li>
      ))}
      {admins.map((admin) => (
        <li key={admin.discordId} className="person">
          <Avatar url={admin.avatarUrl} />
          <div className="person__text">
            <span className="person__name">{admin.name}</span>
            <span className="person__meta">
              Admin, added <When iso={admin.addedAt} />
            </span>
          </div>
          <div className="person__actions">
            <button
              type="button"
              className="button"
              aria-label={`Remove admin rights from ${admin.name}`}
              onClick={() => onRemoveAdmin(admin.discordId)}
            >
              Remove admin
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function GuestManager() {
  const [list, setList] = useState<GuestList | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const apply = useCallback((result: AdminResult): string | null => {
    if (!result.ok) {
      setNotice(result.message);
      return result.message;
    }
    setList(result.list);
    setNotice(null);
    return null;
  }, []);

  useEffect(() => {
    void loadGuestList().then(apply);
  }, [apply]);

  if (list === null) {
    return notice === null ? (
      <p className="admin__empty">Loading the guest list…</p>
    ) : (
      <p className="notice" role="alert">
        {notice}
      </p>
    );
  }

  return (
    <>
      {notice !== null && (
        <p className="notice" role="alert">
          {notice}
        </p>
      )}
      <section className="panel" aria-labelledby="waiting-heading">
        <h2 id="waiting-heading">Waiting to join</h2>
        <RequestList
          requests={list.requests}
          onApprove={(discordId) => void addGuest(discordId, null).then(apply)}
          onDecline={(discordId) => void declineRequest(discordId).then(apply)}
        />
      </section>
      <section className="panel" aria-labelledby="guests-heading">
        <h2 id="guests-heading">Guests</h2>
        <AddGuestForm
          onAdd={async (discordId, label) => {
            // The form says why it failed itself; the page-wide alert is for the buttons.
            const result = await addGuest(discordId, label);
            if (!result.ok) return result.message;
            setList(result.list);
            return null;
          }}
        />
        <GuestRows
          guests={list.guests.filter((guest) => !guest.isAdmin)}
          onMakeAdmin={(discordId) => void setGuestAdmin(discordId, true).then(apply)}
          onRemove={(discordId) => void removeGuest(discordId).then(apply)}
        />
      </section>
      <section className="panel" aria-labelledby="admins-heading">
        <h2 id="admins-heading">Admins</h2>
        <AdminList
          hosts={list.hosts}
          admins={list.guests.filter((guest) => guest.isAdmin)}
          onRemoveAdmin={(discordId) => void setGuestAdmin(discordId, false).then(apply)}
        />
      </section>
    </>
  );
}

/** `/admin`: who may join the room. Admins only — the server refuses anyone else regardless. */
export function AdminPage({ me }: { me: SessionUser }) {
  return (
    <main className="admin">
      <header className="admin__header">
        <h1>Who may join</h1>
        <p className="admin__who">
          <a href="/">Back to the room</a> Signed in as {me.name}. <SignOutButton />
        </p>
      </header>
      {me.isAdmin ? (
        <GuestManager />
      ) : (
        <p className="notice" role="alert">
          Only admins can manage guests.
        </p>
      )}
    </main>
  );
}
