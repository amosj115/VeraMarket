import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ServicePhotoManager } from "@/components/services/service-photo-manager";

export const dynamic = "force-dynamic";

export default async function ManageServicePhotosPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/profile/services/${id}`)}`);
  }
  const service = await prisma.serviceListing.findFirst({
    where: { id, providerId: session.user.id, status: { not: "REMOVED" } },
    select: {
      id: true,
      title: true,
      coverImageUrl: true,
      images: {
        where: { ownerType: "SERVICE" },
        orderBy: { sortOrder: "asc" },
        select: { id: true, url: true, sortOrder: true },
      },
    },
  });
  if (!service) notFound();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/profile/services" className="text-sm font-medium text-brand hover:underline">
        ← Back to my services
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Service photos</h1>
      <p className="mt-2 text-sm text-slate-500">
        Add a cover and examples of your work for <span className="font-medium text-slate-700">{service.title}</span>.
      </p>
      <div className="mt-7">
        <ServicePhotoManager
          serviceId={service.id}
          serviceTitle={service.title}
          initialCoverUrl={service.coverImageUrl}
          initialPhotos={service.images}
        />
      </div>
    </div>
  );
}
