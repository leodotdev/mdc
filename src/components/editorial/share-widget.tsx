import { Check, Link as LinkIcon, Mail, Share2, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// Single Share button that expands inline into a row of platform icons.
// Click the trigger → row animates open. Pressing Esc, clicking outside,
// or hitting any platform closes it. Copy-link toasts a confirmation
// instead of opening a new tab.
//
// All share intents are computed lazily after hydration so we get the
// canonical absolute URL from `window.location` rather than relying on
// a server-rendered base. Title is passed in so platforms that accept
// pre-filled text (X, Bluesky, Threads, email) get the actual headline.

type Platform = {
  key: string
  label: string
  intent: (url: string, title: string) => string
  // Both lucide icons and our inline brand SVGs satisfy this — they all
  // accept the standard SVG props and render <svg>.
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
}

// Tiny brand-style SVGs for X, Facebook, LinkedIn, Bluesky, and Threads.
// Lucide doesn't ship pixel-faithful brand marks (the `Twitter` glyph is
// the old bird, etc.), so we inline minimal versions here. They're built
// to match the lucide icon button frame at size-4.
function XIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M18.244 2H21.5l-7.4 8.46L22.75 22h-6.84l-5.34-6.98L4.5 22H1.24l7.92-9.05L1 2h7l4.83 6.4Zm-1.2 18h1.86L7.04 4H5.06Z" />
    </svg>
  )
}

function FacebookIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M22 12a10 10 0 1 0-11.56 9.88V14.9H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.27c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.45 2.9h-2.33v6.98A10 10 0 0 0 22 12Z" />
    </svg>
  )
}

function LinkedInIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm-.5 15.5v-5.3c0-1.7-.9-2.5-2.1-2.5-1 0-1.5.55-1.7.94v-.81h-2.9c.04.78 0 8.17 0 8.67h2.9v-4.83c0-.26.02-.51.1-.7.2-.51.67-1.05 1.46-1.05 1.03 0 1.44.78 1.44 1.93v4.65ZM7.7 9.62c1 0 1.62-.66 1.62-1.5-.02-.85-.62-1.5-1.6-1.5-.99 0-1.62.65-1.62 1.5 0 .84.62 1.5 1.58 1.5h.02Zm1.45 8.88V9.83H6.25v8.67Z" />
    </svg>
  )
}

function BlueskyIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M6.5 3.5c2.95 2.2 6.13 6.65 7.3 9.04.43.88.65 1.32.92 1.32s.49-.44.92-1.32c1.17-2.39 4.35-6.84 7.3-9.04 2.13-1.6 5.56-2.83 5.56 1.05 0 .77-.44 6.5-.7 7.43-.9 3.23-4.2 4.05-7.13 3.55 5.13.87 6.43 3.77 3.6 6.66-5.36 5.5-7.7-1.38-8.3-3.14-.1-.32-.16-.47-.16-.34 0-.13-.05.02-.16.34-.6 1.76-2.94 8.64-8.3 3.14-2.83-2.89-1.53-5.78 3.6-6.66-2.93.5-6.23-.32-7.13-3.55C-.5 11.05-1 5.32-1 4.55c0-3.88 3.43-2.65 5.56-1.05Z" transform="translate(0)" />
    </svg>
  )
}

function ThreadsIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M12.18 2c5.4 0 9.18 3.04 9.49 7.86l-1.93.18C19.5 6.43 16.69 4 12.18 4 7.7 4 4.45 6.94 4.45 12c0 5 3.21 8 7.73 8 3.5 0 5.78-1.74 6.06-4.34l1.99.17c-.42 3.7-3.59 6.17-8.05 6.17C6.51 22 2.45 18.32 2.45 12 2.45 5.74 6.36 2 12.18 2Zm.45 5.7c2.51 0 4.36 1.32 4.66 3.36l-1.94.27c-.16-1.13-1.16-1.84-2.74-1.84-1.74 0-2.95.94-2.95 2.42 0 1.42 1.07 2.16 3.04 2.61l.6.13c2.65.6 3.85 1.66 3.85 3.5 0 2.36-2.07 3.85-5.04 3.85-3.18 0-5.42-1.7-5.66-4.27l1.93-.18c.18 1.6 1.66 2.61 3.78 2.61 1.86 0 3.07-.79 3.07-2.06 0-1.13-.79-1.71-2.96-2.18l-.7-.16c-2.65-.6-3.78-1.78-3.78-3.78 0-2.41 2.05-3.99 4.84-3.99Z" />
    </svg>
  )
}

const PLATFORMS: Array<Platform> = [
  {
    key: "x",
    label: "Share on X",
    intent: (url, title) =>
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`,
    Icon: XIcon,
  },
  {
    key: "facebook",
    label: "Share on Facebook",
    intent: (url) =>
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
    Icon: FacebookIcon,
  },
  {
    key: "linkedin",
    label: "Share on LinkedIn",
    intent: (url) =>
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
    Icon: LinkedInIcon,
  },
  {
    key: "bluesky",
    label: "Share on Bluesky",
    intent: (url, title) =>
      `https://bsky.app/intent/compose?text=${encodeURIComponent(`${title} ${url}`)}`,
    Icon: BlueskyIcon,
  },
  {
    key: "threads",
    label: "Share on Threads",
    intent: (url, title) =>
      `https://www.threads.net/intent/post?text=${encodeURIComponent(`${title} ${url}`)}`,
    Icon: ThreadsIcon,
  },
  {
    key: "email",
    label: "Share via email",
    intent: (url, title) =>
      `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url)}`,
    Icon: Mail,
  },
]

export function ShareWidget({ title }: { title: string }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on outside click + Esc — feels like every other expanding control.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const currentUrl = () =>
    typeof window !== "undefined" ? window.location.href : ""

  const onCopy = async () => {
    const url = currentUrl()
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success("Link copied")
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("Could not copy link")
    }
  }

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label="Share this story"
      className="my-8 flex items-center gap-2"
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="share-options"
        className="gap-2"
      >
        {open ? <X className="size-4" /> : <Share2 className="size-4" />}
        <span>{open ? "Close" : "Share"}</span>
      </Button>

      <div
        id="share-options"
        className={cn(
          "flex items-center gap-1 overflow-hidden transition-[max-width,opacity] duration-300 ease-out",
          open ? "max-w-[400px] opacity-100" : "max-w-0 opacity-0",
        )}
        aria-hidden={!open}
      >
        {PLATFORMS.map(({ key, label, intent, Icon }) => (
          <a
            key={key}
            href={open ? intent(currentUrl(), title) : "#"}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={label}
            title={label}
            tabIndex={open ? 0 : -1}
            onClick={() => setOpen(false)}
            className="inline-flex size-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Icon className="size-4" />
          </a>
        ))}
        <button
          type="button"
          aria-label="Copy link"
          title="Copy link"
          tabIndex={open ? 0 : -1}
          onClick={() => void onCopy()}
          className="inline-flex size-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {copied ? (
            <Check className="size-4 text-foreground" />
          ) : (
            <LinkIcon className="size-4" />
          )}
        </button>
      </div>
    </div>
  )
}
