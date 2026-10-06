import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Seeds the admin-manageable category taxonomy described in the product spec.
 * This is structural configuration data (not fake marketplace activity) and
 * is required for the category pickers in listing/shop/service/property forms.
 * Safe to run multiple times — upserts by (domain, slug).
 */

const marketplaceCategories = [
  "Electronics",
  "Phones",
  "Computers",
  "Gaming",
  "Furniture",
  "Fashion",
  "Shoes",
  "Home & Garden",
  "Appliances",
  "Vehicles",
  "Automotive",
  "Baby & Kids",
  "Sports",
  "Books",
  "Collectibles",
  "Tools",
  "Beauty",
  "Other",
];

const serviceCategories = [
  "Nanny",
  "Mechanic",
  "Hairdresser",
  "Plumber",
  "Electrician",
  "Cleaner",
  "Gardener",
  "Tutor",
  "Graphic Designer",
  "Photographer",
  "Developer",
  "Beauty Services",
  "Car Services",
  "Home Services",
  "Moving Services",
  "Other",
];

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_-]+/g, "-");
}

async function main() {
  for (const [index, name] of marketplaceCategories.entries()) {
    await prisma.category.upsert({
      where: { domain_slug: { domain: "MARKETPLACE", slug: slugify(name) } },
      update: { name, sortOrder: index },
      create: {
        domain: "MARKETPLACE",
        name,
        slug: slugify(name),
        sortOrder: index,
      },
    });
  }

  for (const [index, name] of serviceCategories.entries()) {
    await prisma.category.upsert({
      where: { domain_slug: { domain: "SERVICE", slug: slugify(name) } },
      update: { name, sortOrder: index },
      create: {
        domain: "SERVICE",
        name,
        slug: slugify(name),
        sortOrder: index,
      },
    });
  }

  console.log("Category taxonomy seeded.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
