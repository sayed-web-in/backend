import { bdDayEndUtc, bdDayStartUtc } from '../../common/bd-time.js';
import type { PurchaseQueryDto } from '../dto/purchase-query.dto.js';
import type { CreatePurchaseReturnDto } from '../dto/create-purchase-return.dto.js';

  export function purchaseWhereFromDto(query: PurchaseQueryDto) {
    const { branchId, supplierId, status, search, dateFrom, dateTo } = query;
    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (supplierId) where.supplierId = supplierId;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { referenceNo: { contains: search } },
        { supplier: { name: { contains: search } } },
      ];
    }
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = bdDayStartUtc(dateFrom);
      if (dateTo) where.createdAt.lte = bdDayEndUtc(dateTo);
    }
    return where;
  }

  export function purchaseReturnWhereFromDto(query: PurchaseQueryDto) {
    const { branchId, search, dateFrom, dateTo, supplierId } = query;
    const parts: any[] = [];
    if (branchId) parts.push({ purchase: { branchId } });
    if (supplierId) parts.push({ purchase: { supplierId } });
    if (search) {
      parts.push({
        OR: [
          { reason: { contains: search } },
          { purchase: { referenceNo: { contains: search } } },
          { purchase: { supplier: { name: { contains: search } } } },
        ],
      });
    }
    if (dateFrom || dateTo) {
      const range: any = {};
      if (dateFrom) range.gte = bdDayStartUtc(dateFrom);
      if (dateTo) range.lte = bdDayEndUtc(dateTo);
      parts.push({ createdAt: range });
    }
    if (parts.length === 0) return {};
    if (parts.length === 1) return parts[0];
    return { AND: parts };
  }

  export function generatePurchaseReferenceNo(): string {
    const ts = Date.now();
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `PUR-${ts}-${rand}`;
  }

  export function generatePurchaseBatchNumber(): string {
    const ts = Date.now();
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `B-${ts}-${rand}`;
  }

  export function composePurchaseReturnReason(dto: CreatePurchaseReturnDto): string | null {
    const blocks: string[] = [];
    if (dto.returnDate?.trim()) blocks.push(`Return date: ${dto.returnDate.trim()}`);
    if (dto.reference?.trim()) blocks.push(`Reference: ${dto.reference.trim()}`);
    if (dto.responsiblePerson?.trim()) {
      blocks.push(`Responsible: ${dto.responsiblePerson.trim()}`);
    }
    if (dto.notes?.trim()) blocks.push(`Notes: ${dto.notes.trim()}`);
    dto.items.forEach((it, idx) => {
      if (it.returnType) {
        blocks.push(
          `Line ${idx + 1} (store product #${it.storeProductId}): ${it.returnType}`,
        );
      }
    });
    if (dto.reason?.trim()) blocks.push(dto.reason.trim());
    const s = blocks.join('\n').trim();
    return s.length ? s : null;
  }
