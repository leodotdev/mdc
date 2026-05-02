import { Outlet, createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_admin/admin/queue")({
  component: QueueLayout,
})

function QueueLayout() {
  return <Outlet />
}
