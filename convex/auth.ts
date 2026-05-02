import { Email } from "@convex-dev/auth/providers/Email"
import { convexAuth } from "@convex-dev/auth/server"

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Email({
      id: "resend",
      // Magic-link mode: don't require the email to be re-entered on the
      // verification page — the token itself is sufficient.
      authorize: undefined,
      maxAge: 60 * 30, // 30 minutes
      async sendVerificationRequest({
        identifier,
        url,
        expires,
      }: {
        identifier: string
        url: string
        expires: Date
      }) {
        const email = identifier
        const apiKey = process.env.AUTH_RESEND_KEY
        if (!apiKey)
          throw new Error("AUTH_RESEND_KEY is not set in Convex env")
        const from =
          process.env.AUTH_RESEND_FROM ??
          "miami.community <onboarding@resend.dev>"
        const expiresMin = Math.round(
          (expires.getTime() - Date.now()) / 60000,
        )

        const html = `<!doctype html><html><body style="font-family:Georgia,serif;max-width:520px;margin:40px auto;color:#1a1a1a;">
<h1 style="font-size:28px;margin:0 0 16px;">miami.community</h1>
<p>Hi — click the link below to sign in. It expires in ${expiresMin} minutes.</p>
<p style="margin:24px 0;"><a href="${url}" style="display:inline-block;padding:12px 18px;background:#1a1a1a;color:#fff;text-decoration:none;border-radius:6px;">Sign in</a></p>
<p style="font-size:13px;color:#666;">Or paste this URL into your browser:<br>${url}</p>
</body></html>`

        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: email,
            subject: "Sign in to miami.community",
            html,
          }),
        })
        if (!res.ok) {
          const text = await res.text()
          throw new Error(`Resend send failed: ${res.status} ${text}`)
        }
      },
    }),
  ],
})
