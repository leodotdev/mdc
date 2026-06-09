// Audience filter — drops events that are technically on a public
// calendar but actually only intended for a closed community
// (students, faculty, staff, members, employees). University iCals
// are the main offenders: events.miami.edu and calendar.fiu.edu
// publish faculty senate meetings, dissertation defenses, RA
// training, course-coded lectures, etc. — none of which a Miami
// reader can act on.
//
// Two passes:
//   1. Phrase block-list — any match drops the event.
//   2. Course-code regex — strings like "BIOL 1010" or "ENGL200" in
//      the title signal a class session, not an event.
//
// Items with "open to the public" / "free and open" / "family day"
// in their copy win even when other keywords match — venues that
// explicitly invite the public override the heuristic.
//
// Pure function — safe to call from adapters, ingest pipeline, and
// the backfill migration. Never LLM-backed.

// Phrases that explicitly invite the public override every block.
const PUBLIC_OVERRIDES =
  /\b(open\s+to\s+the\s+(public|community)|free\s+and\s+open(\s+to\s+the\s+public)?|family\s+day|public\s+lecture|community\s+event|all\s+ages)\b/i

// Strong-signal phrases that drop the event when no public override
// is also present.
const PRIVATE_PHRASES: ReadonlyArray<RegExp> = [
  // Audience-explicit
  /\b(students?\s+only|faculty\s+only|staff\s+only|members?\s+only|employees?\s+only|invit(?:e|ation)\s+only|closed\s+event|private\s+event)\b/i,
  /\bopen\s+(?:only\s+)?to\s+(?:UM|FIU|MDC|Barry|university|college|campus|enrolled|current)\s+(?:students?|faculty|staff|community|members)/i,
  // Audience: Faculty / Students / Staff — iCal CATEGORIES or body
  // text that scopes the event to the university's closed community.
  // Triggers when ANY of those audience labels appear in an
  // "audience"-prefixed phrase, OR when the trio shows up together
  // without a public-override.
  /\baudience\s*[:\-]?\s*(?:faculty|students?|staff|alumni|prospective\s+students?)\b/i,
  /\b(faculty|students?)\s*,\s*(students?|staff)\s*,\s*(students?|staff|alumni)\b/i,
  // Internal governance / admin
  /\b(faculty\s+(?:senate|meeting|assembly|forum|retreat)|department\s+meeting|board\s+meeting\s+\(closed\)|townhall\s+\(staff\)|all[- ]hands)\b/i,
  // Student-life / academic-internal
  /\b(RA\s+(?:training|meeting)|orientation\s+(?:leaders?|crew|staff)|resident\s+assistant|peer\s+(?:mentor|tutor)\s+(?:training|meeting)|student\s+(?:government|senate|council|assembly))\b/i,
  // Class / exam / academic milestones — none of these are events
  /\b(office\s+hours|tutoring|study\s+(?:group|hall|session)|review\s+session|final\s+exam|mid[- ]?term\s+exam|comprehensive\s+exam|defense:|dissertation\s+defense|thesis\s+defense|honors\s+thesis|capstone\s+presentation|course\s+registration|add\/drop|withdrawal\s+deadline|final\s+grades?\s+due|classes\s+(?:start|resume|end|begin)|first\s+day\s+of\s+(?:class|classes|school)|last\s+day\s+of\s+(?:class|classes))\b/i,
  // Higher-ed recruiting + internal training. These are technically
  // "public" but they're Zoom calls for prospective applicants or
  // faculty pedagogy sessions — not local Miami events a reader can
  // attend in person.
  /\b(info(?:rmational?)?\s+(?:session|webinar)|admissions\s+(?:info|workshop|101)|virtual\s+admissions|application\s+workshop|MBA\s+(?:info|virtual)|virtual\s+info)\b/i,
  // Registered-client / RSVP-by-name events — the support-group
  // shape that limits attendees to an existing roster.
  /\bregistered\s+\w+\s+clients?\s+only\b|\bRSVP\s+to\s+(?:Dr\.?\s+|Mr\.?\s+|Ms\.?\s+)?[A-Z]\w+\b/i,
  // "Save the Date" — almost exclusively used by university
  // internal-ops (faculty retreats, training, alumni roundtables).
  // Public events advertise tickets, not save-the-dates.
  /\bsave\s+the\s+date(?:[:!,.\s])/i,
  // 1:1 / one-on-one — bespoke sessions, not a public event.
  /\b(?:1[:\s-]?on[:\s-]?1|one[:\s-]?on[:\s-]?one)\s+(?:training|consultation|session|meeting|tutoring)\b/i,
  /\b(webinar|virtual\s+(?:workshop|meeting|panel|talk|tour|open\s+house|session)|online\s+(?:workshop|meeting|panel)|zoom\s+(?:workshop|meeting|webinar))\b/i,
  /\b(canvas\s+(?:training|course\s+design|pedagogy)|faculty\s+(?:training|development)|instructor\s+training|teaching\s+workshop|pedagogy\s+(?:workshop|consultation))\b/i,
  // Academic-internal seminar / writing-group lingo
  /\b(writing\s+(?:roundtable|group|workshop\s+\(faculty\))|research\s+(?:seminar|colloquium|brown\s+bag)|brown\s+bag\s+(?:lunch|talk)|BYOL|journal\s+club)\b/i,
  // K-12 staff PD
  /\bprofessional\s+development\s+(?:day|session)|teacher\s+planning\s+day|PD\s+day\b/i,
  // Generic Zoom / Teams — anything calling itself a "virtual X"
  // alone has no in-person hook.
  /\b(?:zoom\s+meeting|teams\s+meeting)\b/i,
  // Standardized-test prep — every "X exam boot camp / prep / review"
  // sits on a college calendar and is invariably for that college's
  // students. FCLE in particular is mandatory for FL public-college
  // students, never a public event.
  /\b(FCLE|MCAT|LSAT|GMAT|GRE|TOEFL|FTCE|CLAST)\b/i,
  /\b(test|exam)\s+(?:prep|preparation|boot\s*camp|review\s+session)\b/i,
  /\b(boot\s*camp|prep\s+(?:course|session|workshop))\s+for\s+(?:current\s+)?students\b/i,
  // Orientation / welcome-week / move-in — campus-internal by
  // definition. Even when called "public" they're for the incoming
  // class.
  /\b(new\s+student\s+orientation|welcome\s+week|move[-\s]?in\s+day|first[-\s]?year\s+(?:experience|seminar)|transfer\s+student\s+orientation|orientation\s+(?:day|week|session))\b/i,
  // Academic advising / registration — always student-only.
  /\b(academic\s+advising|drop[-\s]?in\s+advising|advising\s+(?:appointment|session|hours)|major\s+exploration|degree\s+(?:audit|planning)|course\s+(?:planning|selection))\b/i,
  // Student-life / club / greek-life events that don't invite
  // outside attendance.
  /\b(student\s+(?:org(?:anization)?|club)\s+(?:meeting|fair|fest|night)|greek\s+life|sorority\s+(?:recruitment|rush|meeting)|fraternity\s+(?:recruitment|rush|meeting)|RSO\s+(?:meeting|event))\b/i,
  // Career-services campus-only — resume reviews, mock interviews,
  // employer info sessions for that school's students.
  /\b(mock\s+interview|resume\s+(?:review|critique|workshop)|career\s+(?:counseling|coaching|drop[-\s]?in)|employer\s+info\s+session|on[-\s]?campus\s+(?:interview|recruiting))\b/i,
  // Alumni / donor / member-exclusive functions.
  /\b(alumni[-\s]?only|donor[-\s]?(?:only|circle|reception)|member[-\s]?(?:only|exclusive)|patron[-\s]?only|trustee\s+(?:meeting|dinner|reception))\b/i,
  // Honor society / scholar inductions — closed ceremonies for
  // selected students.
  /\b(honor\s+society|phi\s+(?:beta\s+kappa|kappa\s+phi|theta\s+kappa)|induction\s+ceremony|scholars\s+(?:reception|induction))\b/i,
  // Internship / co-op specific — for that school's pipeline.
  /\b(internship\s+(?:fair|info\s+session|workshop|program\s+orientation)|co[-\s]?op\s+(?:orientation|info\s+session))\b/i,
  // Graduation / commencement-adjacent (rehearsals, regalia pickup —
  // graduation itself is technically public but the auxiliary events
  // around it are not).
  /\b(commencement\s+rehearsal|graduation\s+rehearsal|regalia\s+(?:pickup|distribution)|cap\s+and\s+gown\s+distribution|grad\s+fair)\b/i,
  // Library / lab tours for new students.
  /\b(library\s+(?:orientation|tour)\s+for\s+(?:new|incoming)|lab\s+safety\s+training|IRB\s+training)\b/i,
  // Academic-calendar milestones — never "events" a reader can
  // attend; they're rows on the registrar's calendar. "Last day to
  // add/drop", "Registration opens", "Finals week", etc.
  /\blast\s+day\s+to\s+(?:add|drop|change|withdraw|register|petition|file|submit|apply)\b/i,
  /\b(?:fall|spring|summer|winter)\s+(?:open\s+)?registration\s+(?:opens?|closes?|begins?|ends?)\b/i,
  /\b(grading\s+option|grade\s+(?:appeals?|change)|incomplete\s+grades?|withdrawal\s+period)\b/i,
  /\b(finals?\s+week|midterms?\s+week|reading\s+(?:day|period)|study\s+(?:day|period))\b/i,
  /\b(census\s+date|drop\/add\s+(?:period|deadline)|tuition\s+due|fee\s+payment\s+deadline)\b/i,
  // Handshake = student career portal. Any event referencing it is
  // for enrolled students.
  /\bhandshake\s+(?:refresher|workshop|training|orientation)\b/i,
  // Career-services event vocabulary that the existing patterns miss.
  /\bcareer\s+(?:tools|options|coach(?:ing)?\s+drop[-\s]?in|exploration|panel\s+for\s+students)\b/i,
  /\bexploring\s+careers?\b/i,
  /\bcover\s+letter\s+(?:workshop|review|critique)\b/i,
  /\bresume\s+and\s+(?:cover\s+letter|interview)\s+workshop\b/i,
  // Graduate-program internal: coffee chats, MBA / JD / LLM / MFA
  // mixers, dissertation events, prospective-student events.
  /\b(MBA|JD|LLM|MFA|MD|MS|MA|PhD|DPT|EdD|DBA)\s+(?:coffee\s+(?:chat|hour)|mixer|reception|info\s+session|virtual\s+visit|admit(?:ted)?\s+student|dissertation)\b/i,
  /\bdissertation\s+(?:open\s+house|reception|proposal\s+defense)\b/i,
  /\b(?:prospective|admitted|incoming)\s+students?\s+(?:reception|mixer|event|day)\b/i,
  // Law-school internal events — "Beer on the Bricks", "Coffee on the
  // Bricks", "Fridays on the Bricks" are UM Law's recurring student-
  // only mixers at their courtyard. Catch the venue pattern.
  /\b(?:beer|coffee|fridays?|wine)\s+on\s+the\s+bricks\b/i,
  /\blaw\s+school\s+(?:tour|orientation|mixer|reception|barbecue)\b/i,
  /\bjury\s+selection\s+training\b/i,
  // Student-org "General Body Meeting" pattern.
  /\b(?:general\s+body\s+meeting|GBM|chapter\s+meeting|exec\s+(?:board\s+)?meeting)\b/i,
]

// Course-code pattern: 2-4 capital letters followed by 3-4 digits.
// "BIOL 1010", "ENGL200", "MTH-301". Allow a single space or hyphen
// between the letters and the digits. Anchored by word boundaries so
// random uppercase strings don't trigger.
const COURSE_CODE = /\b[A-Z]{2,4}[\s-]?\d{3,4}\b/

export function isPrivateAudience(
  opts: {
    title: string
    description?: string | null
    body?: string | null
  },
  /** DB-backed extra audience blocks layered over the hardcoded
   *  baseline. Snapshot via `internal.taxonomy.snapshot`; pass each
   *  row's `pattern` string. Bad regexes are silently skipped. */
  extraBlocks?: ReadonlyArray<string>,
): boolean {
  const haystack = [opts.title, opts.description ?? "", opts.body ?? ""]
    .join(" ")
    .trim()
  if (haystack.length === 0) return false

  // Public-override wins.
  if (PUBLIC_OVERRIDES.test(haystack)) return false

  for (const re of PRIVATE_PHRASES) {
    if (re.test(haystack)) return true
  }

  // DB-backed editor overrides.
  for (const pat of extraBlocks ?? []) {
    let re: RegExp
    try {
      re = new RegExp(pat, "i")
    } catch {
      continue
    }
    if (re.test(haystack)) return true
  }

  // Course-code check runs on title only — descriptions sometimes
  // mention course codes incidentally ("co-sponsored by BIOL 1010")
  // without the event itself being a class session.
  if (COURSE_CODE.test(opts.title)) return true

  return false
}
