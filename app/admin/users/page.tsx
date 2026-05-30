export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import AdminNav from "../_components/AdminNav";
import UserActions from "./UserActions";

interface Props {
  searchParams: Promise<{ secret?: string }>;
}

export default async function AdminUsersPage({ searchParams }: Props) {
  const { secret } = await searchParams;

  if (!secret || secret !== process.env.SCRAPE_SECRET) {
    return (
      <div className="max-w-screen-md mx-auto px-6 py-16 text-center">
        <p className="font-body text-on-surface-variant">Access denied.</p>
      </div>
    );
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });

  return (
    <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <AdminNav secret={secret} current="users" />

      <div className="mt-8 max-w-2xl">
        <h1 className="font-headline font-black text-2xl text-on-surface lowercase mb-1">
          editor accounts
        </h1>
        <p className="font-body text-xs text-on-surface-variant mb-8">
          Accounts can sign in via magic link and edit any event.
        </p>

        <UserActions secret={secret} users={users} />
      </div>
    </div>
  );
}
