/**
 * Well-known ids of the default Exam and Specialty created by migration
 * 20260721000001_exams_specialties.sql. Pure constants — importable from
 * import-core, server code and tests alike.
 *
 * Blank Exam/Specialty cells in bulk-import sheets, and pre-hierarchy
 * content generally, resolve to these rows. Admins may rename them, so
 * resolve display names by id, never by name.
 */
export const DEFAULT_EXAM_ID = "e0000000-0000-0000-0000-000000000001";
export const DEFAULT_SPECIALTY_ID = "5c000000-0000-0000-0000-000000000001";
