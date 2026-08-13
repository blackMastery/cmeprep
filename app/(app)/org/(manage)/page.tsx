import { redirect } from "next/navigation";

/** The org dashboard ships with SPEC §8; members is home until then. */
export default function OrgIndexPage() {
  redirect("/org/members");
}
