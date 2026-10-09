import type { IStorage } from '../../storage';

/** One fresh, branch-scoped snapshot per enquiry; never retained between runs. */
export async function preloadEnquiryLocations(storage: IStorage, branchId: string): Promise<IStorage> {
  const locations = await storage.getAllEmployeeLocations(branchId);
  // Preserve the repository's exact-name lookup semantics.
  const byName = new Map(locations.map(location => [location.employeeName, location]));
  return new Proxy(storage, {
    get(target, property) {
      if (property === 'getEmployeeLocationByName') {
        return async (requestedBranch: string, name: string) => {
          if (requestedBranch !== branchId) throw new Error('Enquiry location snapshot branch mismatch');
          return byName.get(name);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
