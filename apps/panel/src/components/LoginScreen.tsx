import { useState } from 'react';
import { Button, Field, Wordmark } from '@prochia/ui';
import { errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { isDesktop, session } from '../lib/session';

/** Seeded staff accounts, one per role, offered as one-tap logins in the static demo. */
const DEMO_LOGINS = [
  ['owner', 'مالک'],
  ['manager', 'مدیر شعبه'],
  ['kitchen', 'رستوران'],
  ['barista', 'کافه'],
  ['storage', 'انبار'],
  ['cashier', 'صندوق'],
] as const;
const DEMO_PASSWORD = 'prochia1234';

export function LoginScreen() {
  const auth = useAuth();
  const [server, setServer] = useState(session.server ?? '');
  const [editingServer, setEditingServer] = useState(isDesktop && !session.server);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (as = { username, password }) => {
    setBusy(true);
    setError(null);
    try {
      if (editingServer) session.server = server.trim();
      await auth.login(as.username.trim(), as.password);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login__form">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Wordmark size={36} subtitle="پنل کارکنان" />
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 900, marginTop: 'var(--space-4)' }}>
            ورود کارکنان
          </h1>
          {editingServer && (
            <Field label="آدرس سرور" hint="مثلاً https://panel.prochia.ir — یک بار تنظیم می‌شود.">
              <input
                className="pc-input pc-input--ltr"
                value={server}
                onChange={(e) => setServer(e.target.value)}
                placeholder="https://"
              />
            </Field>
          )}
          <Field label="نام کاربری">
            <input
              className="pc-input pc-input--ltr"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </Field>
          <Field label="رمز عبور" error={error}>
            <input
              className="pc-input pc-input--ltr"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
          <Button
            type="submit"
            variant="primary"
            size="l"
            block
            loading={busy}
            disabled={!username || !password || (editingServer && !server)}
          >
            ورود
          </Button>
          {import.meta.env.VITE_DEMO && (
            <div className="login__demo">
              <span className="hint">نسخهٔ نمایشی — ورود با یکی از نقش‌ها:</span>
              <div className="login__roles">
                {DEMO_LOGINS.map(([user, label]) => (
                  <Button
                    key={user}
                    size="s"
                    disabled={busy}
                    onClick={() => {
                      setUsername(user);
                      setPassword(DEMO_PASSWORD);
                      void submit({ username: user, password: DEMO_PASSWORD });
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {isDesktop && !editingServer && (
            <Button variant="ghost" size="s" onClick={() => setEditingServer(true)}>
              تغییر سرور
            </Button>
          )}
        </form>
      </div>
      <div className="login__side">
        <Wordmark size={32} />
        <div className="stack">
          <h2>
            از سفارش تا انبار،
            <br />
            همه در یک جا.
          </h2>
          <p>
            رستوران تأیید می‌کند، کافه آماده می‌کند، انبار خودکار کم می‌شود و مشتری لحظه‌به‌لحظه خبر
            دارد.
          </p>
        </div>
        <span className="hint" style={{ color: 'rgba(255,255,255,.6)' }}>
          پروچیا — تغذیه ورزشی باشگاه
        </span>
      </div>
    </div>
  );
}
