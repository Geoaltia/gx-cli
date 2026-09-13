/** A STAC API gx knows how to query. */
export interface StacProvider {
  id: string;
  name: string;
  /** API root, without trailing slash. */
  url: string;
  /** Largest `limit` the API accepts per page (with the fields extension). */
  maxPageSize: number;
}

/**
 * Copernicus Data Space Ecosystem. Catalogue search is public: no account or
 * token is needed to list scenes and read their metadata.
 */
export const COPERNICUS_CDSE: StacProvider = {
  id: "cdse",
  name: "Copernicus Data Space Ecosystem",
  url: "https://stac.dataspace.copernicus.eu/v1",
  maxPageSize: 200,
};
