import Image from "next/image";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatZAR } from "@/lib/utils";
import { FavoriteToggle } from "@/components/favorites/favorite-toggle";
import { FollowButton } from "@/components/follow/follow-button";
import { VerifiedBadge } from "@/components/profile/verified-badge";
import { appUrl } from "@/lib/app-url";
import { isShopVisible } from "@/lib/shops";
import { getTrust } from "@/lib/trust";
import { listAchievements } from "@/lib/achievements";
import { publicUrl } from "@/lib/share";
import { cardMetadata, getShareCard, unavailableMetadata } from "@/lib/share-meta";
import { ShareButton } from "@/components/share/share-button";
import { SharedLinkTracker } from "@/components/share/shared-link-tracker";
import { ShopChatButton } from "@/components/share/shop-chat-button";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
	const { slug } = await params;
	const card = await getShareCard("SHOP", slug);
	return card ? cardMetadata(card, slug) : unavailableMetadata;
}

export default async function ShopDetailPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SearchParams }) {
	const { slug } = await params;
	const values = await searchParams;
	const query = typeof values.q === "string" ? values.q.trim() : "";
	const categorySlug = typeof values.category === "string" ? values.category.trim() : "";
	const shop = await prisma.shop.findUnique({
		where: { slug },
		include: {
			products: { where: { isAvailable: true }, orderBy: { createdAt: "desc" }, include: { images: { orderBy: { sortOrder: "asc" } }, category: true } },
			categories: { orderBy: { sortOrder: "asc" } },
			subscription: true,
			owner: { select: { id: true, displayName: true, username: true, profileVerification: true } },
		},
	});
	if (!shop || !isShopVisible(shop)) notFound();

	const [trust, achievements, sellerListings] = await Promise.all([
		getTrust(shop.owner.id),
		listAchievements(shop.owner.id),
		prisma.listing.findMany({ where: { sellerId: shop.owner.id, status: "ACTIVE" }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, slug: true, title: true, priceCents: true, location: true, images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } } } }),
	]);
	const earned = achievements.filter((item) => item.awardedAt);
	const url = publicUrl(appUrl(), "SHOP", shop.slug);
	const jsonLd = { "@context": "https://schema.org", "@type": "Store", name: shop.name, description: shop.description.slice(0, 300), url, ...(shop.logoUrl ? { image: shop.logoUrl.startsWith("http") ? shop.logoUrl : appUrl() + shop.logoUrl } : {}) };

	const filteredProducts = shop.products.filter((product) => {
		const haystack = `${product.name} ${product.description}`.toLowerCase();
		const matchesQuery = !query || haystack.includes(query.toLowerCase());
		const matchesCategory = !categorySlug || product.category?.slug === categorySlug || product.categoryId === categorySlug;
		return matchesQuery && matchesCategory;
	});

	return <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8"><Link href="/shops" className="text-sm font-medium text-brand">← Back to Virtual Stores</Link><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} /><SharedLinkTracker target="SHOP" targetId={shop.id} /><div className="mt-6 border-b border-border pb-8"><div className="flex items-start gap-4">{shop.logoUrl ? <Image src={shop.logoUrl} alt={`${shop.name} logo`} width={80} height={80} sizes="(max-width: 640px) 64px, 80px" className="h-16 w-16 shrink-0 rounded-xl bg-slate-100 object-cover sm:h-20 sm:w-20" /> : <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-brand text-2xl font-semibold text-white sm:h-20 sm:w-20">{shop.name.charAt(0).toUpperCase()}</div>}<div className="min-w-0 flex-1"><p className="text-sm font-medium text-brand">Virtual Store</p><h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{shop.name}</h1></div><ShareButton target="SHOP" targetId={shop.id} url={url} title={shop.name} label="Share Shop" variant="outline" className="shrink-0" /></div><p className="mt-2 text-sm text-slate-600">Owned by <Link href={`/u/${shop.owner.username}`} className="font-semibold hover:text-brand">{shop.owner.displayName}</Link> <VerifiedBadge verified={shop.owner.profileVerification === "VERIFIED"} /></p><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">{shop.description}</p><div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-500"><span>{shop.address}</span></div>{(trust || earned.length > 0) && <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">{trust && <span className="rounded-full bg-brand-light px-3 py-1 font-medium text-brand">Vera Trust {trust.score}/100 · {trust.tier}</span>}{earned.slice(0, 4).map((item) => <span key={item.id} className="rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-700">🏆 {item.name}</span>)}</div>}<div className="mt-4 flex flex-wrap gap-2">{shop.categories.length > 0 ? shop.categories.map((category) => <span key={category.id} className="rounded-full border border-border bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">{category.name}</span>) : <span className="rounded-full border border-dashed border-border px-3 py-1 text-xs text-slate-500">All Products</span>}</div><div className="mt-4 flex flex-wrap items-start gap-3"><ShopChatButton shopId={shop.id} shopName={shop.name} /><FollowButton kind="shop" id={shop.id} label="Follow shop" /></div><FavoriteToggle targetType="SHOP" targetId={shop.id} /></div><section className="mt-8"><div className="flex flex-col gap-3 md:flex-row md:items-end"><h2 className="text-xl font-semibold">Products</h2><form method="get" className="ml-auto flex w-full max-w-xl flex-col gap-2 sm:flex-row">
			<input name="q" defaultValue={query} placeholder="Search products" className="flex-1 rounded-md border border-border px-3 py-2 text-sm" />
			<select name="category" defaultValue={categorySlug} className="rounded-md border border-border bg-white px-3 py-2 text-sm">
				<option value="">All categories</option>
				{shop.categories.map((category) => <option key={category.id} value={category.slug}>{category.name}</option>)}
			</select>
			<button type="submit" className="rounded-md border border-brand px-4 py-2 text-sm font-semibold text-brand">Filter</button>
		</form></div>{filteredProducts.length === 0 ? <p className="mt-5 rounded-lg border border-dashed border-border px-6 py-12 text-center text-sm text-slate-500">{query || categorySlug ? "No products match your search." : "This virtual store has not added any products yet."}</p> : <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{filteredProducts.map((product) => <div key={product.id} className="rounded-lg border border-border bg-white p-4"><h3 className="font-medium">{product.name}</h3>{product.category && <p className="mt-1 text-xs font-medium uppercase tracking-wide text-brand">{product.category.name}</p>}<p className="mt-2 text-sm text-slate-500">{product.description}</p><p className="mt-4 font-semibold text-brand">{formatZAR(product.priceCents)}</p>{product.salePriceCents && <p className="mt-1 text-xs text-emerald-700">Sale price {formatZAR(product.salePriceCents)}</p>}</div>)}</div>}</section>{sellerListings.length > 0 && <section className="mt-10"><h2 className="text-lg font-semibold">More from this seller</h2><p className="mt-1 text-sm text-slate-500">Marketplace listings from {shop.owner.displayName}. Each one carries this store&apos;s 🏪 badge while the subscription is active.</p><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{sellerListings.map((item) => <Link key={item.id} href={`/listing/${item.slug}`} className="overflow-hidden rounded-lg border border-border bg-white hover:shadow-md"><div className="relative aspect-square bg-slate-100">{item.images[0] ? <Image src={item.images[0].url} alt={item.title} fill sizes="(max-width: 640px) 50vw, 25vw" className="object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-slate-400">No image</div>}</div><div className="p-3"><p className="truncate text-sm font-medium">{item.title}</p><p className="mt-1 text-sm font-semibold text-brand">{formatZAR(item.priceCents)}</p><p className="mt-1 truncate text-xs text-slate-500">{item.location}</p></div></Link>)}</div></section>}</div>;
}
