import { Calendar, Download } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// Add-to-calendar dropdown — ghost trigger that matches `<ShareWidget>`
// so the two sit flush in the event meta strip. Items: Google Calendar
// (intent URL) + Apple/Outlook (.ics download generated client-side).

type CalendarEvent = {
  id: string
  title: string
  description: string
  startsAt: number
  endsAt?: number
  allDay: boolean
  locationName?: string
  locationAddress?: string
  url?: string
}

function GoogleIcon(props: React.SVGProps<SVGSVGElement>) {
  // Minimal Google "G" mark, sized to match other size-4 lucide icons
  // in the menu.
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <path
        fill="#4285F4"
        d="M22.5 12.27c0-.79-.07-1.55-.2-2.27H12v4.3h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.75h3.57c2.09-1.93 3.22-4.77 3.22-8.09Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.99 7.28-2.69l-3.57-2.75c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.28-1.93-6.14-4.52H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.86 14.1c-.22-.66-.34-1.36-.34-2.1s.12-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.94l3.68-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.07.56 4.21 1.64l3.16-3.16C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.68 2.84c.86-2.59 3.28-4.52 6.14-4.52Z"
      />
    </svg>
  )
}

function formatIcsDate(ts: number, allDay: boolean): string {
  const d = new Date(ts)
  if (allDay) {
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`
  }
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
}

function escapeIcs(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
}

function buildIcs(event: CalendarEvent): string {
  const dtStart = formatIcsDate(event.startsAt, event.allDay)
  const dtEnd = formatIcsDate(
    event.endsAt ?? event.startsAt + 60 * 60 * 1000,
    event.allDay,
  )
  const location = [event.locationName, event.locationAddress]
    .filter(Boolean)
    .join(", ")
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//miami.community//Events//EN",
    "BEGIN:VEVENT",
    `UID:${event.id}@miami.community`,
    `DTSTAMP:${formatIcsDate(Date.now(), false)}`,
    event.allDay ? `DTSTART;VALUE=DATE:${dtStart}` : `DTSTART:${dtStart}`,
    event.allDay ? `DTEND;VALUE=DATE:${dtEnd}` : `DTEND:${dtEnd}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    event.description ? `DESCRIPTION:${escapeIcs(event.description)}` : "",
    location ? `LOCATION:${escapeIcs(location)}` : "",
    event.url ? `URL:${escapeIcs(event.url)}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean)
  return lines.join("\r\n")
}

function googleCalendarUrl(event: CalendarEvent): string {
  const fmt = (ts: number) =>
    new Date(ts).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
  const start = fmt(event.startsAt)
  const end = fmt(event.endsAt ?? event.startsAt + 60 * 60 * 1000)
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${start}/${end}`,
    details: event.description,
    location: [event.locationName, event.locationAddress]
      .filter(Boolean)
      .join(", "),
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

export function AddToCalendar({ event }: { event: CalendarEvent }) {
  const downloadIcs = () => {
    const ics = buildIcs(event)
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${
      event.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "event"
    }.ics`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success("Calendar invite downloaded", {
      description: "Open the .ics to add to Apple Calendar / Outlook.",
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" aria-label="Add to calendar">
            <Calendar className="size-4" />
            Add to calendar
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem
          className="cursor-pointer"
          render={
            <a
              href={googleCalendarUrl(event)}
              target="_blank"
              rel="noreferrer"
            />
          }
        >
          <GoogleIcon className="size-4" />
          Google Calendar
        </DropdownMenuItem>
        <DropdownMenuItem
          className="cursor-pointer"
          onClick={downloadIcs}
        >
          <Download className="size-4" />
          Apple / Outlook (.ics)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
