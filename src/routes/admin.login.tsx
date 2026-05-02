import { useAuthActions } from "@convex-dev/auth/react"
import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Loader2 } from "lucide-react"
import { useEffect, useState } from "react"

import { api } from "../../convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useTranslation } from "@/lib/i18n/context"

type LoginSearch = {
  error?: "forbidden"
}

export const Route = createFileRoute("/admin/login")({
  validateSearch: (search): LoginSearch => ({
    error: search.error === "forbidden" ? "forbidden" : undefined,
  }),
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate()
  const { signIn } = useAuthActions()
  const search = Route.useSearch()
  const { t } = useTranslation()
  const { data: me } = useQuery(convexQuery(api.me.current, {}))

  const [email, setEmail] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (me?.isEditor) {
      void navigate({ to: "/admin" })
    }
  }, [me, navigate])

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4">
      <div className="w-full max-w-sm">
        <h1 className="font-brand text-4xl leading-none md:text-5xl">
          {t("brand.name")}
        </h1>
        <p className="meta mt-1">editorial sign-in</p>

        {search.error === "forbidden" ? (
          <p className="mt-6 rounded border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            That email is not on the editor allowlist.
          </p>
        ) : null}

        {sent ? (
          <div className="mt-8 rounded border bg-card p-4">
            <p className="font-editorial">
              Check your inbox — we sent a sign-in link to{" "}
              <strong>{email}</strong>.
            </p>
            <p className="meta mt-2 text-sm">
              The link will sign you in and bring you back here.
            </p>
            <button
              type="button"
              className="meta mt-3 text-xs underline hover:text-foreground"
              onClick={() => {
                setSent(false)
                setEmail("")
              }}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form
            className="mt-8 flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault()
              setErr(null)
              setSubmitting(true)
              try {
                await signIn("resend", { email })
                setSent(true)
              } catch (caught) {
                setErr(
                  caught instanceof Error
                    ? caught.message
                    : "Could not send link",
                )
              } finally {
                setSubmitting(false)
              }
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={submitting || !email}>
              {submitting ? (
                <>
                  <Loader2 className="animate-spin" /> Sending…
                </>
              ) : (
                "Email me a sign-in link"
              )}
            </Button>
            {err ? (
              <p className="text-sm text-destructive">{err}</p>
            ) : null}
          </form>
        )}
      </div>
    </main>
  )
}
