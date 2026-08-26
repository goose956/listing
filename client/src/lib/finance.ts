import type { Item } from '../types';

export interface ItemFinanceSummary {
  purchasePrice: number;
  salePrice: number | null;
  extraCosts: number;
  grossProfit: number | null;
  netProfit: number | null;
  marginPercent: number | null;
}

export interface FinanceSummary {
  soldCount: number;
  revenue: number;
  grossProfit: number;
  netProfit: number;
  totalExtraCosts: number;
  averageNetProfit: number;
  averageSalePrice: number;
  inventorySpend: number;
  unsoldInventoryCost: number;
}

export function sumItemExtraCosts(item: Pick<Item, 'platform_fee' | 'shipping_cost' | 'packaging_cost' | 'other_costs'>): number {
  const costs: Array<number | null | undefined> = [
    item.platform_fee,
    item.shipping_cost,
    item.packaging_cost,
    item.other_costs,
  ];
  return costs.reduce<number>((sum, value) => sum + toAmount(value), 0);
}

export function getItemFinanceSummary(item: Pick<Item, 'purchase_price' | 'sale_price' | 'platform_fee' | 'shipping_cost' | 'packaging_cost' | 'other_costs'>): ItemFinanceSummary {
  const purchasePrice = toAmount(item.purchase_price);
  const salePrice = item.sale_price == null ? null : toAmount(item.sale_price);
  const extraCosts = sumItemExtraCosts(item);
  const grossProfit = salePrice == null ? null : salePrice - purchasePrice;
  const netProfit = salePrice == null ? null : salePrice - purchasePrice - extraCosts;
  const marginPercent = salePrice != null && salePrice > 0 && netProfit != null
    ? (netProfit / salePrice) * 100
    : null;

  return {
    purchasePrice,
    salePrice,
    extraCosts,
    grossProfit,
    netProfit,
    marginPercent,
  };
}

export function buildFinanceSummary(items: Item[]): FinanceSummary {
  const soldItems = items.filter((item) => item.status === 'sold' && item.sale_price != null);
  const netProfits = soldItems.map((item) => getItemFinanceSummary(item).netProfit ?? 0);
  const grossProfits = soldItems.map((item) => getItemFinanceSummary(item).grossProfit ?? 0);
  const revenues = soldItems.map((item) => Number(item.sale_price ?? 0));
  const totalExtraCosts = soldItems.reduce((sum, item) => sum + sumItemExtraCosts(item), 0);
  const inventorySpend = items.reduce((sum, item) => sum + toAmount(item.purchase_price), 0);
  const unsoldInventoryCost = items
    .filter((item) => item.status !== 'sold' && item.status !== 'archived')
    .reduce((sum, item) => sum + toAmount(item.purchase_price), 0);

  return {
    soldCount: soldItems.length,
    revenue: revenues.reduce((sum, value) => sum + value, 0),
    grossProfit: grossProfits.reduce((sum, value) => sum + value, 0),
    netProfit: netProfits.reduce((sum, value) => sum + value, 0),
    totalExtraCosts,
    averageNetProfit: netProfits.length > 0 ? netProfits.reduce((sum, value) => sum + value, 0) / netProfits.length : 0,
    averageSalePrice: revenues.length > 0 ? revenues.reduce((sum, value) => sum + value, 0) / revenues.length : 0,
    inventorySpend,
    unsoldInventoryCost,
  };
}

function toAmount(value: number | null | undefined): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}