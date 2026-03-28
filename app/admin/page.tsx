import { redirect } from "next/navigation";

interface Props {
  searchParams: Promise<{ secret?: string }>;
}

export default async function AdminPage({ searchParams }: Props) {
  const { secret } = await searchParams;
  redirect(`/admin/metrics?secret=${secret ?? ""}`);
}
