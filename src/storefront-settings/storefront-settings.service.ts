import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  HeaderBrandMode,
  FooterLinkSection,
  Prisma,
} from '@prisma/client';
import { UpsertStorefrontSettingsDto } from './dto/upsert-storefront-settings.dto.js';

const defaultMarketing = () => ({
  gtmContainerId: '',
  publicSiteUrl: '',
  gtmCurrency: 'BDT',
  metaPixelId: '',
});

@Injectable()
export class StorefrontSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureBaseRows(tx: Prisma.TransactionClient) {
    let topBar = await tx.topBarConfig.findFirst({ orderBy: { id: 'asc' } });
    if (!topBar) {
      topBar = await tx.topBarConfig.create({ data: {} });
    }

    let header = await tx.headerBrandConfig.findFirst({ orderBy: { id: 'asc' } });
    if (!header) {
      header = await tx.headerBrandConfig.create({
        data: { mode: HeaderBrandMode.TEXT },
      });
    }

    let footer = await tx.footerConfig.findFirst({ orderBy: { id: 'asc' } });
    if (!footer) {
      footer = await tx.footerConfig.create({ data: {} });
    }

    let marketing = await tx.storefrontMarketingConfig.findFirst({
      orderBy: { id: 'asc' },
    });
    if (!marketing) {
      marketing = await tx.storefrontMarketingConfig.create({ data: {} });
    }

    return { topBar, header, footer, marketing };
  }

  async getPublicSettings() {
    const [topBar, header, footer, marketing] = await Promise.all([
      this.prisma.topBarConfig.findFirst({
        orderBy: { id: 'asc' },
        include: {
          links: {
            where: { isActive: true },
            orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
          },
        },
      }),
      this.prisma.headerBrandConfig.findFirst({ orderBy: { id: 'asc' } }),
      this.prisma.footerConfig.findFirst({
        orderBy: { id: 'asc' },
        include: {
          links: {
            where: { isActive: true },
            orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
          },
        },
      }),
      this.prisma.storefrontMarketingConfig.findFirst({
        orderBy: { id: 'asc' },
      }),
    ]);

    return {
      topBar: topBar ?? { phoneLabel: '', phoneHref: '', isPhoneShown: true, links: [] },
      headerBrand: header ?? { mode: HeaderBrandMode.TEXT, brandName: '', brandLogoUrl: '' },
      footer: {
        ...(footer ?? {
          description: '',
          address: '',
          phone: '',
          email: '',
          hours: '',
          copyrightText: '',
          links: [],
        }),
        description: footer?.description ?? '',
        quickLinks:
          footer?.links.filter((x) => x.section === FooterLinkSection.QUICK) ?? [],
        customerLinks:
          footer?.links.filter((x) => x.section === FooterLinkSection.CUSTOMER) ?? [],
      },
      marketing: marketing
        ? {
            gtmContainerId: marketing.gtmContainerId,
            publicSiteUrl: marketing.publicSiteUrl,
            gtmCurrency: marketing.gtmCurrency,
            metaPixelId: marketing.metaPixelId,
          }
        : defaultMarketing(),
    };
  }

  async upsert(dto: UpsertStorefrontSettingsDto) {
    await this.prisma.$transaction(async (tx) => {
      const { topBar, header, footer, marketing } = await this.ensureBaseRows(tx);

      await tx.topBarConfig.update({
        where: { id: topBar.id },
        data: {
          phoneLabel: dto.topPhoneLabel ?? topBar.phoneLabel,
          phoneHref: dto.topPhoneHref ?? topBar.phoneHref,
        },
      });

      await tx.headerBrandConfig.update({
        where: { id: header.id },
        data: {
          mode: dto.headerBrandMode ?? header.mode,
          brandName: dto.brandName ?? header.brandName,
          brandLogoUrl: dto.brandLogoUrl ?? header.brandLogoUrl,
          proprietorName: dto.proprietorName ?? header.proprietorName,
        },
      });

      await tx.footerConfig.update({
        where: { id: footer.id },
        data: {
          description: dto.footerDescription ?? footer.description ?? '',
          address: dto.footerAddress ?? footer.address,
          phone: dto.footerPhone ?? footer.phone,
          email: dto.footerEmail ?? footer.email,
          hours: dto.footerHours ?? footer.hours,
          copyrightText: dto.copyrightText ?? footer.copyrightText,
        },
      });

      if (dto.topLinks) {
        await tx.topBarLink.deleteMany({ where: { topBarId: topBar.id } });
        if (dto.topLinks.length) {
          await tx.topBarLink.createMany({
            data: dto.topLinks.map((x, i) => ({
              topBarId: topBar.id,
              label: x.label,
              href: x.href,
              displayOrder: i + 1,
              isActive: true,
            })),
          });
        }
      }

      if (dto.footerQuickLinks || dto.footerCustomerLinks) {
        await tx.footerLink.deleteMany({ where: { footerId: footer.id } });
        const links = [
          ...(dto.footerQuickLinks ?? []).map((x, i) => ({
            footerId: footer.id,
            section: FooterLinkSection.QUICK,
            label: x.label,
            href: x.href,
            displayOrder: i + 1,
            isActive: true,
          })),
          ...(dto.footerCustomerLinks ?? []).map((x, i) => ({
            footerId: footer.id,
            section: FooterLinkSection.CUSTOMER,
            label: x.label,
            href: x.href,
            displayOrder: i + 1,
            isActive: true,
          })),
        ];
        if (links.length) {
          await tx.footerLink.createMany({ data: links });
        }
      }

      const mData: {
        gtmContainerId?: string;
        publicSiteUrl?: string;
        gtmCurrency?: string;
        metaPixelId?: string;
      } = {};
      if (dto.marketingGtmContainerId !== undefined) {
        mData.gtmContainerId = dto.marketingGtmContainerId;
      }
      if (dto.marketingPublicSiteUrl !== undefined) {
        mData.publicSiteUrl = dto.marketingPublicSiteUrl;
      }
      if (dto.marketingGtmCurrency !== undefined) {
        mData.gtmCurrency = dto.marketingGtmCurrency;
      }
      if (dto.marketingMetaPixelId !== undefined) {
        mData.metaPixelId = dto.marketingMetaPixelId;
      }
      if (Object.keys(mData).length > 0) {
        await tx.storefrontMarketingConfig.update({
          where: { id: marketing.id },
          data: mData,
        });
      }
    });

    return this.getPublicSettings();
  }
}
