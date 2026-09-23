/**
 * Starting price list from the spec (§7–§8), entered as given: base / default offer (SAR) / minutes.
 * English names are translations for the English interface (editable in the catalog).
 */
export const CATEGORIES = [
  { code: 'massage', nameAr: 'المساج', nameEn: 'Massage' },
  { code: 'wax', nameAr: 'الواكس', nameEn: 'Waxing' },
  { code: 'nails', nameAr: 'الأظافر', nameEn: 'Nails' },
  { code: 'skin_body', nameAr: 'البشرة والجسم', nameEn: 'Skin & body' },
  { code: 'lashes', nameAr: 'الرموش', nameEn: 'Lashes' },
] as const

export const SERVICES: readonly { code: string; category: (typeof CATEGORIES)[number]['code']; nameAr: string; nameEn: string; base: number; offer: number; minutes: number }[] = [
  { code: 'massage_relaxing', category: 'massage', nameAr: 'المساج الاسترخائي', nameEn: 'Relaxing massage', base: 250, offer: 196, minutes: 60 },
  { code: 'massage_swedish', category: 'massage', nameAr: 'المساج السويدي', nameEn: 'Swedish massage', base: 250, offer: 196, minutes: 60 },
  { code: 'massage_lymphatic', category: 'massage', nameAr: 'المساج اللمفاوي', nameEn: 'Lymphatic massage', base: 350, offer: 296, minutes: 60 },
  { code: 'massage_lymph_drainage', category: 'massage', nameAr: 'مساج التصريف اللمفاوي', nameEn: 'Lymphatic drainage massage', base: 350, offer: 296, minutes: 60 },
  { code: 'massage_hot_stone', category: 'massage', nameAr: 'مساج الأحجار الساخنة مع الأعشاب والزيت الحار', nameEn: 'Hot stone massage with herbs and hot oil', base: 350, offer: 296, minutes: 60 },
  { code: 'massage_head_hands_feet', category: 'massage', nameAr: 'مساج الرأس واليدين والقدمين', nameEn: 'Head, hands and feet massage', base: 150, offer: 96, minutes: 30 },
  { code: 'massage_scalp', category: 'massage', nameAr: 'مساج فروة الرأس مع تنظيف الفروة', nameEn: 'Scalp massage with scalp cleansing', base: 150, offer: 96, minutes: 20 },
  { code: 'wax_full_body', category: 'wax', nameAr: 'واكس الجسم كامل', nameEn: 'Full body wax', base: 300, offer: 196, minutes: 60 },
  { code: 'wax_face_feet', category: 'wax', nameAr: 'واكس الوجه والقدمين', nameEn: 'Face and feet wax', base: 150, offer: 96, minutes: 30 },
  { code: 'wax_one_area', category: 'wax', nameAr: 'واكس منطقة من اختيارك', nameEn: 'Wax — one area of your choice', base: 150, offer: 96, minutes: 30 },
  { code: 'nails_classic_mani_pedi', category: 'nails', nameAr: 'بديكير ومناكير كلاسيك مع لون عادي', nameEn: 'Classic pedicure & manicure with regular polish', base: 200, offer: 146, minutes: 30 },
  { code: 'nails_mani_pedi_gel_hands', category: 'nails', nameAr: 'بديكير ومناكير + جل لليدين', nameEn: 'Pedicure & manicure + gel on hands', base: 250, offer: 196, minutes: 60 },
  { code: 'nails_gel_extension', category: 'nails', nameAr: 'جل إكستنشن مع لون جل', nameEn: 'Gel extensions with gel colour', base: 500, offer: 396, minutes: 140 },
  { code: 'nails_weekly_regular', category: 'nails', nameAr: 'أظافر أسبوعية مع لون عادي', nameEn: 'Weekly nails with regular polish', base: 200, offer: 96, minutes: 30 },
  { code: 'nails_weekly_gel', category: 'nails', nameAr: 'أظافر أسبوعية مع لون جل', nameEn: 'Weekly nails with gel colour', base: 300, offer: 196, minutes: 30 },
  { code: 'skin_classic_facial', category: 'skin_body', nameAr: 'تنظيف بشرة كلاسيك', nameEn: 'Classic facial cleansing', base: 200, offer: 96, minutes: 30 },
  { code: 'skin_paraffin', category: 'skin_body', nameAr: 'بارافين لليدين والقدمين', nameEn: 'Paraffin for hands and feet', base: 200, offer: 96, minutes: 30 },
  { code: 'skin_facial_vitamin_c', category: 'skin_body', nameAr: 'تنظيف بشرة مع ماسك فيتامين C', nameEn: 'Facial cleansing with vitamin C mask', base: 300, offer: 196, minutes: 40 },
  { code: 'skin_facial_collagen', category: 'skin_body', nameAr: 'تنظيف بشرة مع ماسك الكولاجين', nameEn: 'Facial cleansing with collagen mask', base: 300, offer: 196, minutes: 40 },
  { code: 'skin_deep_brightening', category: 'skin_body', nameAr: 'تنظيف بشرة عميق مع ماسك لتفتيح البشرة', nameEn: 'Deep facial cleansing with brightening mask', base: 300, offer: 196, minutes: 40 },
  { code: 'lashes_weekly', category: 'lashes', nameAr: 'رموش أسبوعية', nameEn: 'Weekly lashes', base: 220, offer: 196, minutes: 30 },
  { code: 'lashes_lift', category: 'lashes', nameAr: 'رفع الرموش', nameEn: 'Lash lift', base: 220, offer: 196, minutes: 60 },
]

export const PACKAGES: readonly {
  code: string
  nameAr: string
  nameEn: string
  base: number
  offer: number
  persons: number
  visits: number
  visitMinutes: number
  specialistsPerVisit: number
  components: { service: string; quantity: number; taskMinutes: number }[]
}[] = [
  {
    code: 'pkg_swedish_2',
    nameAr: 'باقة المساج السويدي',
    nameEn: 'Swedish Massage Package',
    base: 700,
    offer: 496,
    persons: 1,
    visits: 2,
    visitMinutes: 60,
    specialistsPerVisit: 1,
    components: [{ service: 'massage_swedish', quantity: 1, taskMinutes: 60 }],
  },
  {
    code: 'pkg_complete_relaxation',
    nameAr: 'بكج الاسترخاء المتكامل',
    nameEn: 'Complete Relaxation Package',
    base: 700,
    offer: 496,
    persons: 1,
    visits: 1,
    visitMinutes: 140,
    specialistsPerVisit: 2,
    components: [
      { service: 'massage_hot_stone', quantity: 1, taskMinutes: 60 },
      { service: 'nails_classic_mani_pedi', quantity: 1, taskMinutes: 30 },
      { service: 'skin_paraffin', quantity: 1, taskMinutes: 30 },
    ],
  },
  {
    code: 'pkg_friends',
    nameAr: 'باقة الصديقات',
    nameEn: 'Friends Package',
    base: 700,
    offer: 496,
    persons: 2,
    visits: 1,
    visitMinutes: 120,
    specialistsPerVisit: 2,
    components: [
      { service: 'massage_relaxing', quantity: 2, taskMinutes: 60 },
      { service: 'nails_classic_mani_pedi', quantity: 2, taskMinutes: 30 },
    ],
  },
  {
    code: 'pkg_relax_care',
    nameAr: 'Relax & Care',
    nameEn: 'Relax & Care',
    base: 650,
    offer: 396,
    persons: 1,
    visits: 1,
    visitMinutes: 160,
    specialistsPerVisit: 2,
    components: [
      { service: 'massage_relaxing', quantity: 1, taskMinutes: 60 },
      { service: 'nails_classic_mani_pedi', quantity: 1, taskMinutes: 30 },
      { service: 'skin_paraffin', quantity: 1, taskMinutes: 30 },
      { service: 'lashes_weekly', quantity: 1, taskMinutes: 30 },
    ],
  },
  {
    code: 'pkg_relaxation_2',
    nameAr: 'باقة الاسترخاء',
    nameEn: 'Relaxation Package',
    base: 500,
    offer: 396,
    persons: 1,
    visits: 2,
    visitMinutes: 90,
    specialistsPerVisit: 1,
    components: [{ service: 'massage_relaxing', quantity: 1, taskMinutes: 90 }],
  },
]
