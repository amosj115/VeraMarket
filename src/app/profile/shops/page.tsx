import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ShopManagement } from "@/components/shops/shop-management";

export const dynamic = "force-dynamic";

export default async function MyShopsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/profile/shops");
  const shops = await prisma.shop.findMany({
    where: { ownerId: session.user.id, status: { not: "REMOVED" } },
    orderBy: { updatedAt: "desc" },
    include: {
      categories: { orderBy: { sortOrder: "asc" } },
      products: {
        orderBy: { createdAt: "desc" },
        include: { images: { orderBy: { sortOrder: "asc" } }, category: true },
      },
      subscription: true,
    },
  });
  return <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8"><div className="flex items-end justify-between gap-4"><div><p className="text-sm font-medium text-brand">Your account</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">My Virtual Stores</h1><p className="mt-2 text-sm text-slate-500">Manage storefront details, products, and monthly subscription status.</p></div><Link href="/shops/new" className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white">Create Virtual Store</Link></div>{shops.length === 0 ? <div className="mt-8 rounded-lg border border-dashed border-border px-6 py-16 text-center"><p className="font-medium">No Virtual Stores yet</p><p className="mt-1 text-sm text-slate-500">Stores you create will appear here once they are saved.</p></div> : <div className="mt-8 space-y-5">{shops.map((shop) => <ShopManagement key={shop.id} shop={shop} />)}</div>}</div>;
}
