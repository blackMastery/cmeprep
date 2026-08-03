import type { Metadata } from "next";
import Link from "next/link";
import { OG_IMAGE, SITE_NAME, SUPPORT_EMAIL, TWITTER_IMAGE } from "@/lib/site";
import { EcgDivider } from "@/components/brand/ecg-line";

/**
 * NOT LEGAL ADVICE. This describes what the application actually does — the
 * data it stores, the three companies it relies on, the fact that it runs no
 * analytics — but it has not been reviewed by a lawyer. Have one read it
 * before you rely on it, and keep it in step with the code: every factual
 * claim below is checkable against supabase/migrations and lib/.
 *
 * Fill these in when the company details are settled. They are deliberately
 * unused rather than rendered as visible [PLACEHOLDER] text, so nothing
 * half-finished ever reaches a visitor.
 *
 *   LEGAL ENTITY : e.g. "CMEPrep Inc."
 *   ADDRESS      : registered office
 *   GOVERNING LAW: the jurisdiction whose law applies to disputes
 *
 * Once known, add a "Who we are" section naming the entity and address, and a
 * governing-law line to "Contact".
 */

const LAST_UPDATED = "30 July 2026";

const PRIVACY_TITLE = "Privacy Policy";
const PRIVACY_DESCRIPTION = `How ${SITE_NAME} handles your account details, study activity and payments — what we store, who we share it with, and how to get it changed or deleted.`;

export const metadata: Metadata = {
  title: PRIVACY_TITLE,
  description: PRIVACY_DESCRIPTION,
  alternates: { canonical: "/privacy" },
  // `images` is repeated here deliberately — declaring openGraph/twitter at
  // page level replaces the root's instead of merging, so omitting it would
  // strip og:image from this page. See lib/site.ts.
  openGraph: {
    url: "/privacy",
    title: `${PRIVACY_TITLE} · ${SITE_NAME}`,
    description: PRIVACY_DESCRIPTION,
    images: [OG_IMAGE],
  },
  twitter: {
    title: `${PRIVACY_TITLE} · ${SITE_NAME}`,
    description: PRIVACY_DESCRIPTION,
    images: [TWITTER_IMAGE],
  },
};

type PolicySection = {
  heading: string;
  body?: readonly string[];
  list?: readonly string[];
};

const SECTIONS: readonly PolicySection[] = [
  {
    heading: "What this covers",
    body: [
      `This policy explains what ${SITE_NAME} collects when you use the site, why we hold it, and what you can ask us to do with it. It applies to the website and to your study account.`,
    ],
  },
  {
    heading: "What we collect",
    body: ["We collect only what the service needs to work:"],
    list: [
      "Account details — your name and email address, plus a password that is stored only in hashed form. We never see your password.",
      "Study activity — the tests you create, the answers you select, how long you spend, your scores, and any questions you bookmark or write notes on. This is what powers your dashboard and progress tracking.",
      "Purchase records — which plan and examination you bought, when your access ends, and the reference number PayPal gives the transaction. We also keep a record of the payment notifications PayPal sends us.",
      "A session cookie — set when you log in, so the site knows it is still you as you move between pages.",
    ],
  },
  {
    heading: "What we do not collect",
    body: [
      "We do not receive or store your card, bank or PayPal login details. Payments are handled entirely by PayPal on their own systems; we are only told whether a payment succeeded and given a reference for it.",
      "We run no analytics, advertising or tracking of any kind. There are no third-party scripts, tracking pixels or advertising cookies on this site, and the fonts are served from our own servers rather than fetched from an outside provider. The only cookie we set is the login session cookie described above, which is why you are not asked to accept cookie tracking.",
    ],
  },
  {
    heading: "How we use it",
    list: [
      "To give you access to the question bank and to run your practice tests.",
      "To show your results, progress and weak areas.",
      "To confirm what you have paid for and when that access ends.",
      "To send account emails — verifying your address and resetting your password.",
      "To keep the service secure and to investigate misuse.",
    ],
  },
  {
    heading: "Who else is involved",
    body: [
      "We keep the list of companies that can touch your data as short as we can. Each one is used for a single purpose:",
    ],
    list: [
      "Supabase — stores the database, handles logins and hosts uploaded question images.",
      "PayPal — processes payments. Their own privacy policy governs what they collect when you pay.",
      "Vercel — hosts the website and serves it to your browser.",
    ],
  },
  {
    heading: "Where your data is held",
    body: [
      "The companies above operate servers outside the Caribbean, so your information is stored and processed abroad. We use them because they provide the security and reliability we could not run ourselves.",
    ],
  },
  {
    heading: "How long we keep it",
    body: [
      "We keep your account and study history for as long as your account exists, because your progress statistics depend on it. Purchase records are kept longer where we need them for accounting. If you ask us to delete your account, we remove your personal details and study history, though anonymous records that cannot be traced back to you may remain.",
    ],
  },
  {
    heading: "Your choices",
    body: [
      "You can change your name and password yourself from your profile page at any time.",
      `For anything else — a copy of what we hold, a correction, or deletion of your account — email ${SUPPORT_EMAIL} from the address on your account and we will handle it. Deleting your account ends any remaining paid access, and we cannot restore your study history afterwards.`,
    ],
  },
  {
    heading: "Security",
    body: [
      "The site is served over an encrypted connection, passwords are hashed rather than stored, and access to the database is restricted so that you can only ever read your own records. No system is perfectly secure, but we do not collect data we do not need — which is the most reliable protection there is.",
    ],
  },
  {
    heading: "Children",
    body: [
      "This service is intended for medical students and qualified practitioners preparing for professional examinations. It is not aimed at children, and we do not knowingly create accounts for them.",
    ],
  },
  {
    heading: "Changes to this policy",
    body: [
      "If we change how we handle your information, we will update this page and the date at the top. Significant changes will be notified by email.",
    ],
  },
  {
    heading: "Contact",
    body: [
      `Questions about this policy, or about your data, go to ${SUPPORT_EMAIL}.`,
    ],
  },
];

export default function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:py-16">
      <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
        Privacy Policy
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Last updated {LAST_UPDATED}
      </p>

      <EcgDivider className="my-10" />

      <div className="space-y-10">
        {SECTIONS.map((section) => (
          <section key={section.heading}>
            <h2 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
              {section.heading}
            </h2>

            {section.body?.map((paragraph) => (
              <p
                key={paragraph.slice(0, 32)}
                className="mt-4 leading-relaxed text-muted-foreground"
              >
                {paragraph}
              </p>
            ))}

            {section.list && (
              <ul className="mt-4 space-y-2.5">
                {section.list.map((item) => (
                  <li
                    key={item.slice(0, 32)}
                    className="flex gap-3 leading-relaxed text-muted-foreground"
                  >
                    <span
                      className="mt-2.5 size-1.5 shrink-0 rounded-full bg-primary"
                      aria-hidden="true"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <EcgDivider className="my-10" />

      <p className="text-sm text-muted-foreground">
        See also our{" "}
        <Link href="/about" className="text-primary underline underline-offset-2">
          About page
        </Link>{" "}
        for who we are and what {SITE_NAME} does.
      </p>
    </div>
  );
}
