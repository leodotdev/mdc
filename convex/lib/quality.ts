// Quality scoring for newly-extracted events. Cheap heuristic over
// completeness signals + classifier confidence. Events below a
// threshold get parked in `pending_review` so a human approves before
// they go live — protects the front page from low-confidence
// extraction noise.

export type QualityInput = {
  title: string
  dek?: string | null
  description?: string | null
  body?: string | null
  startsAt: number
  endsAt?: number | null
  allDay?: boolean
  locationName?: string | null
  locationAddress?: string | null
  price?: string | null
  url?: string | null
  hasCoords: boolean
  classifierConfidence: number
}

export type QualityResult = {
  score: number
  /** True = auto-approve. False = park in `pending_review`. */
  autoApprove: boolean
  reasons: ReadonlyArray<string>
}

const APPROVE_THRESHOLD = 0.55

export function scoreEventQuality(input: QualityInput): QualityResult {
  const reasons: Array<string> = []
  let s = 0
  // Title — a 5-120 char title is the baseline floor.
  const title = input.title.trim()
  if (title.length >= 5 && title.length <= 120) {
    s += 0.15
    reasons.push("+title-length")
  } else {
    reasons.push("-title-length")
  }
  // Address present — anchors the event in real space.
  if (input.locationAddress && input.locationAddress.trim().length >= 6) {
    s += 0.18
    reasons.push("+address")
  } else if (input.locationName && input.locationName.trim().length >= 4) {
    s += 0.08
    reasons.push("+venue-only")
  }
  // Lat/lng resolved (geocoder hit or neighborhood centroid).
  if (input.hasCoords) {
    s += 0.1
    reasons.push("+coords")
  }
  // Price or "free" labeled.
  if (input.price && input.price.trim().length > 0) {
    s += 0.07
    reasons.push("+price")
  }
  // Source URL — readers should be able to leave for the venue's page.
  if (input.url && /^https?:\/\//i.test(input.url)) {
    s += 0.05
    reasons.push("+url")
  }
  // Description / dek / body present.
  const body =
    (input.dek ?? input.description ?? input.body ?? "").trim()
  if (body.length >= 30) {
    s += 0.1
    reasons.push("+description")
  }
  // Classifier confidence — high-precision rules (venue, host, keyword)
  // contribute more than low-precision (tag, fallback).
  s += 0.25 * input.classifierConfidence
  reasons.push(
    `+classifier-conf:${input.classifierConfidence.toFixed(2)}`,
  )
  // Penalties.
  if (title.length > 0 && title === title.toUpperCase() && title.length > 10) {
    s -= 0.1
    reasons.push("-shouting-title")
  }
  if (/\b(test|tbd|placeholder)\b/i.test(title)) {
    s -= 0.2
    reasons.push("-placeholder-title")
  }
  // Clamp.
  s = Math.max(0, Math.min(1, s))
  return {
    score: Number(s.toFixed(3)),
    autoApprove: s >= APPROVE_THRESHOLD,
    reasons,
  }
}
