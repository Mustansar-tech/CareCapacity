import { getAllFranchises } from "../../server/repositories/day-rate.repository";
(async () => {
  const all = await getAllFranchises();
  const gn = all.filter(f => f.office === "Glasgow North");
  console.log(JSON.stringify(gn.map(f => ({ id: f.id, name: f.franchiseName, office: f.office })), null, 2));
  process.exit(0);
})();
