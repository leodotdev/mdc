import { useAuthActions } from "@convex-dev/auth/react"
import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import {
  Link,
  Outlet,
  createFileRoute,
  useNavigate,
} from "@tanstack/react-router"
import { LogOut } from "lucide-react"
import { useEffect } from "react"

import { api } from "../../convex/_generated/api"
import { ThemeSwitcher } from "@/components/site/theme-switcher"
import { Button } from "@/components/ui/button"
import { useTranslation } from "@/lib/i18n/context"

export const Route = createFileRoute("/_admin")({
  component: AdminLayout,
})

function AdminLayout() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { signOut } = useAuthActions()
  const { data: me, isLoading } = useQuery(convexQuery(api.me.current, {}))

  useEffect(() => {
    if (isLoading) return
    if (!me) {
      void navigate({ to: "/admin/login" })
      return
    }
    if (!me.isEditor) {
      void navigate({ to: "/admin/login", search: { error: "forbidden" } })
    }
  }, [isLoading, me, navigate])

  if (isLoading || !me) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <p className="meta">Authenticating…</p>
      </div>
    )
  }

  if (!me.isEditor) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <p className="meta">Forbidden — redirecting…</p>
      </div>
    )
  }

  const navItems = [
    { to: "/admin", label: "Dashboard" },
    { to: "/admin/published", label: "Published" },
    { to: "/admin/sources", label: "Sources" },
    { to: "/admin/runs", label: "Runs" },
  ] as const

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="border-b">
        <div className="flex w-full items-center justify-between gap-4 px-6 py-3">
          <Link to="/admin" className="flex items-baseline gap-2">
            <span className="font-brand text-2xl leading-none">
              {t("brand.name")}
            </span>
            <span className="meta font-sans">/ editorial</span>
          </Link>
          <nav className="hidden items-center gap-4 md:flex">
            {navItems.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                activeProps={{
                  className: "text-foreground font-medium",
                }}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <ThemeSwitcher />
            <Button
              variant="ghost"
              size="sm"
              title={me.email ?? undefined}
              onClick={() => {
                void signOut().then(() => navigate({ to: "/admin/login" }))
              }}
            >
              <LogOut /> Sign out
            </Button>
          </div>
        </div>
        <nav className="flex w-full gap-3 px-6 pb-2 md:hidden">
          {navItems.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeProps={{ className: "text-foreground font-medium" }}
              className="text-sm text-muted-foreground"
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="w-full flex-1 px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
