import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatZAR } from "@/lib/utils";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ServicesPage({ searchParams }: { searchParams: SearchParams }) {
	const params = await searchParams;
	const query = typeof params.q === "string" ? params.q.trim() : "";
	const category = typeof params.category === "string" ? params.category : "";
	const [categories, services] = await Promise.all([
		prisma.category.findMany({ where: { domain: "SERVICE", isEnabled: true }, orderBy: { sortOrder: "asc" } }),
		prisma.serviceListing.findMany({
			where: { status: "ACTIVE", ...(query ? { OR: [{ title: { contains: query, mode: "insensitive" } }, { description: { contains: query, mode: "insensitive" } }, { serviceArea: { contains: query, mode: "insensitive" } }] } : {}), ...(category ? { category: { slug: category } } : {}) },
			orderBy: { createdAt: "desc" }, take: 48, include: { category: true, provider: { select: { username: true, displayName: true, identityVerification: true } } },
		}),
	]);
	return <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-medium text-brand">Vera Market</p><h1 className="mt-1 text-3xl font-semibold">Services</h1><p className="mt-2 text-sm text-slate-500">Find people and businesses offering services.</p></div><Link href="/services/new" className="rounded-md bg-brand px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-brand-dark">Offer a service</Link></div><form method="get" className="mt-8 flex flex-col gap-3 sm:flex-row"><input name="q" defaultValue={query} placeholder="Service, provider, or area" className="min-w-0 flex-1 rounded-md border border-border px-4 py-2.5 text-sm" /><select name="category" defaultValue={category} className="rounded-md border border-border bg-white px-4 py-2.5 text-sm"><option value="">All service categories</option>{categories.map((item) => <option key={item.id} value={item.slug}>{item.name}</option>)}</select><button className="rounded-md border border-brand px-5 py-2.5 text-sm font-semibold text-brand">Search</button></form>{services.length === 0 ? <div className="mt-8 rounded-lg border border-dashed border-border px-6 py-16 text-center"><p className="font-medium">{query || category ? "No services match your search" : "No services yet"}</p><p className="mt-1 text-sm text-slate-500">{query || category ? "Try another search or category." : "Service providers will appear here when they join."}</p></div> : <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{services.map((service) => <Link key={service.id} href={`/services/${service.slug}`} className="rounded-lg border border-border bg-white p-5 hover:border-brand hover:shadow-sm"><div className="flex items-start justify-between gap-3"><h2 className="font-semibold">{service.title}</h2>{service.provider.identityVerification === "VERIFIED" && <span className="text-xs font-medium text-emerald-700">Verified</span>}</div><p className="mt-2 line-clamp-2 text-sm text-slate-500">{service.description}</p><p className="mt-4 text-sm font-medium text-brand">{service.priceCents == null ? "Request a quote" : `${formatZAR(service.priceCents)} · ${service.pricingType.toLowerCase()}`}</p><p className="mt-1 text-xs text-slate-400">{service.category.name} · {service.serviceArea}</p></Link>)}</div>}</div>;
}
