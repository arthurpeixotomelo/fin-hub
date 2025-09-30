import { actions } from "astro:actions";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import styles from "../../styles/AuthModal.module.css";
import Button from "../Atoms/Button.tsx";

type ActionState = {
  success?: boolean;
  error?: string;
  needsRegistration?: boolean;
  userId?: string;
};

export default function AuthModal(): ReactNode {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [actionState, setActionState] = useState<ActionState>({});
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const result = await actions.checkAuth();
        if (result?.data?.user) {
          setIsAuthenticated(true);
        } else {
          setOpen(true);
        }
      } catch (error) {
        console.error("Auth check failed:", error);
      }
    };
    checkAuth();
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);

    const formData = new FormData(event.currentTarget);
    const actionName = event.currentTarget.getAttribute("data-action");

    if (actionName === "register") {
      const userId = formData.get("userId");
      if (typeof userId === "string") {
        formData.set("id", userId);
      }
    }

    try {
      let result;

      if (actionName === "login") {
        result = await actions.login(formData);
      }

      if (actionName === "register") {
        result = await actions.register(formData);
      }

      if (result?.data) {
        setActionState(result.data);
        if (result.data.success) {
          setOpen(false);
          setIsAuthenticated(true);
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (!open || isAuthenticated) return null;

  const isRegister = actionState.needsRegistration === true;
  const submitLabel = isRegister ? "Register" : "Log in";
  const submitLoadingLabel = isRegister ? "Registering..." : "Logging in...";

  return (
    <div role="dialog" aria-modal="true" className={styles.overlay}>
      <div className={styles.dialog} data-auth-dialog>
        <div className={styles.content}>
          {actionState.error && (
            <div role="alert" className={styles.error}>{actionState.error}</div>
          )}
          <form
            onSubmit={handleSubmit}
            data-action={isRegister ? "register" : "login"}
            className={styles.form}
          >
            <div className={styles.field}>
              <label htmlFor="userId">
                <span>User ID</span>
              </label>
              <input
                id="userId"
                name="userId"
                type="text"
                placeholder="Enter your user ID"
                defaultValue={actionState.userId}
                required
                disabled={isLoading}
                autoFocus
                className={styles.input}
              />
            </div>
            {isRegister && (
              <>
                <div className={styles.field}>
                  <label htmlFor="email">
                    <span>Email</span>
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    disabled={isLoading}
                    className={styles.input}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="name">
                    <span>Full Name</span>
                  </label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    required
                    disabled={isLoading}
                    className={styles.input}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="team">
                    <span>Team</span>
                  </label>
                  <select
                    id="team"
                    name="team"
                    defaultValue="Internal"
                    required
                    disabled={isLoading}
                    className={styles.select}
                  >
                    <option value="Internal">Internal</option>
                    <option value="CFO">CFO</option>
                  </select>
                </div>
              </>
            )}
            <div className={styles.actions}>
              <Button
                type="submit"
                variant="primary"
                loading={isLoading}
                className={styles.submit}
              >
                {isLoading ? submitLoadingLabel : submitLabel}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
