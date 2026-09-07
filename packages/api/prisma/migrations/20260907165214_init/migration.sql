-- CreateEnum
CREATE TYPE "auth_provider" AS ENUM ('LOCAL', 'GITHUB', 'GOOGLE');

-- CreateEnum
CREATE TYPE "device_type" AS ENUM ('MOBILE', 'DESKTOP', 'TABLET', 'UNKNOWN');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "password_hash" TEXT,
    "provider" "auth_provider" NOT NULL DEFAULT 'LOCAL',
    "provider_id" TEXT,
    "avatar_url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "links" (
    "id" UUID NOT NULL,
    "short_code" TEXT NOT NULL,
    "original_url" TEXT NOT NULL,
    "is_custom" BOOLEAN NOT NULL DEFAULT false,
    "user_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMPTZ(3),
    "click_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clicks" (
    "id" UUID NOT NULL,
    "link_id" UUID NOT NULL,
    "ip_address" INET,
    "country" TEXT,
    "city" TEXT,
    "device_type" "device_type" NOT NULL DEFAULT 'UNKNOWN',
    "browser" TEXT,
    "os" TEXT,
    "referrer" TEXT,
    "clicked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "click_date" DATE NOT NULL,

    CONSTRAINT "clicks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_provider_provider_id_key" ON "users"("provider", "provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "links_short_code_key" ON "links"("short_code");

-- CreateIndex
CREATE INDEX "links_user_id_created_at_idx" ON "links"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "links_expires_at_idx" ON "links"("expires_at");

-- CreateIndex
CREATE INDEX "clicks_link_id_clicked_at_idx" ON "clicks"("link_id", "clicked_at" DESC);

-- CreateIndex
CREATE INDEX "clicks_clicked_at_idx" ON "clicks"("clicked_at");

-- CreateIndex
CREATE INDEX "clicks_link_id_click_date_ip_address_idx" ON "clicks"("link_id", "click_date", "ip_address");

-- AddForeignKey
ALTER TABLE "links" ADD CONSTRAINT "links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clicks" ADD CONSTRAINT "clicks_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
