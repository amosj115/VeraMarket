import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { activeShopFilter } from "@/lib/shops";

export const dynamic = "force-dynamic";

export default async function ShopsPage() {
  const shops = await prisma.shop.findMany({
    where: activeShopFilter(),
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, slug: true, description: true, address: true, verification: true, _count: { select: { products: true } } },
  });
  return <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-medium text-brand">Vera Market</p><h1 className="mt-1 text-3xl font-semibold">Virtual Stores</h1><p className="mt-2 text-sm text-slate-500">Public storefronts require an active R59/month subscription.</p></div><Link href="/shops/new" className="rounded-md bg-brand px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-brand-dark">Create a Virtual Store</Link></div>{shops.length === 0 ? <div className="mt-10 rounded-lg border border-dashed border-border px-6 py-16 text-center"><p className="font-medium">No virtual stores yet</p><p className="mt-1 text-sm text-slate-500">No public storefronts are currently active on Vera Market.</p></div> : <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{shops.map((shop) => <Link key={shop.id} href={`/shops/${shop.slug}`} className="rounded-lg border border-border bg-white p-5 hover:border-brand hover:shadow-sm"><div className="flex items-start justify-between gap-3"><h2 className="font-semibold">{shop.name}</h2>{shop.verification === "VERIFIED" && <span className="text-xs font-medium text-emerald-700">Verified</span>}</div><p className="mt-3 line-clamp-3 text-sm text-slate-500">{shop.description}</p><p className="mt-4 text-xs text-slate-400">{shop.address} · {shop._count.products} products</p></Link>)}</div>}</div>;
}
