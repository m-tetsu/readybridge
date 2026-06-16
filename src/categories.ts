export const PILLARS = {
  prepare: {
    label: '平時の備え',
    short: '平時',
    tagline: 'これから備える企業へ',
    desc: '事業を止めないための、平時のうちにできる備え。BCP策定・資金・設備・体制・備蓄。',
    href: '/prepare',
    icon: 'shield',
  },
  recover: {
    label: '有事の対応・再建',
    short: '有事',
    tagline: '被災した企業へ',
    desc: '被災後にまず確認すべき公的支援。給与・資金繰り・施設復旧・税。',
    href: '/recover',
    icon: 'wrench',
  },
} as const;

export type PillarKey = keyof typeof PILLARS;

export const CATEGORIES = {
  // --- 平時の備え（prepare） ---
  bcp: {
    pillar: 'prepare',
    label: 'BCP（事業継続計画）',
    trouble: '何から備え始めればいい？',
    desc: 'BCPの策定・運用、優先業務の整理',
    icon: 'document',
  },
  'fund-prep': {
    pillar: 'prepare',
    label: '資金の備え',
    trouble: '災害に備えた資金の準備は？',
    desc: '手元資金、損害保険・共済、与信枠の確保',
    icon: 'bank',
  },
  'facility-prep': {
    pillar: 'prepare',
    label: '拠点・設備・データ',
    trouble: '設備やデータを守るには？',
    desc: '耐震化、代替拠点、データのバックアップ',
    icon: 'monitor',
  },
  org: {
    pillar: 'prepare',
    label: '体制・訓練',
    trouble: '社内の体制づくりは？',
    desc: '安否確認、連絡網、避難・復旧訓練',
    icon: 'compass',
  },
  stock: {
    pillar: 'prepare',
    label: '備蓄・調達',
    trouble: '何を備蓄しておくべき？',
    desc: '備蓄品、サプライチェーンの代替確保',
    icon: 'box',
  },

  // --- 有事の対応・再建（recover） ---
  wage: {
    pillar: 'recover',
    label: '給与・雇用',
    trouble: '従業員の給与・雇用をどうすれば',
    desc: '休業手当、雇用調整助成金、解雇・休業の扱い',
    icon: 'users',
  },
  finance: {
    pillar: 'recover',
    label: '資金繰り・融資',
    trouble: '当面の資金が足りない',
    desc: '災害復旧貸付、保証制度、既存債務の返済猶予',
    icon: 'banknote',
  },
  facility: {
    pillar: 'recover',
    label: '施設・設備の復旧',
    trouble: '工場・店舗が壊れてしまった',
    desc: 'なりわい再建・グループ補助金など施設復旧支援',
    icon: 'factory',
  },
  tax: {
    pillar: 'recover',
    label: '税・公共料金',
    trouble: '税金や公共料金が払えない',
    desc: '納税猶予、各種減免、公共料金の支払い猶予',
    icon: 'clipboard',
  },
} as const;

export type CategoryKey = keyof typeof CATEGORIES;

export const CATEGORY_KEYS = Object.keys(CATEGORIES) as CategoryKey[];

export function categoriesByPillar(pillar: PillarKey): CategoryKey[] {
  return CATEGORY_KEYS.filter((k) => CATEGORIES[k].pillar === pillar);
}

export function pillarOf(category: CategoryKey): PillarKey {
  return CATEGORIES[category].pillar as PillarKey;
}
