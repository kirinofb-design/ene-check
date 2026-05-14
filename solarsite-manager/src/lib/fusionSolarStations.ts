/** FusionSolar コレクター・UI 分割取得で共通利用する発電所一覧（NE は Huawei 側 ID） */
export const FUSION_SOLAR_STATIONS = [
  { name: "フジHD湖西発電所", ne: "33652418" },
  { name: "フジHD袋井市豊住高圧発電所", ne: "34130688" },
  { name: "フジHD菊川市高橋第二発電所", ne: "33860228" },
  { name: "フジHD牧之原市白井発電所", ne: "33733199" },
  { name: "フジHD御前崎市合戸第二発電所", ne: "34631202" },
  { name: "フジHD御前崎市佐倉第三発電所", ne: "34364567" },
  { name: "フジ物産掛川市浜野高圧発電所", ne: "33558911" },
  { name: "フジ物産御前崎市佐倉高圧発電所", ne: "33559317" },
];

const KNOWN_NE = new Set(FUSION_SOLAR_STATIONS.map((s) => s.ne));

export function isKnownFusionStationNe(ne: string): boolean {
  return KNOWN_NE.has(ne.trim());
}
