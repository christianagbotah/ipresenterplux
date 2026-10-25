import { redirect } from "next/navigation";
import { auth } from "@auth";
import DashboardPage from "./DashboardPage";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.forcePasswordChange) redirect("/change-password");

  return <DashboardPage />;
}
