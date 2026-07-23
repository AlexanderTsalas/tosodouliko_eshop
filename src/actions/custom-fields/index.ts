/**
 * Custom Fields engine — server actions barrel (Phase 8b+).
 */

// Field-level CRUD
export { createCustomField } from "./createCustomField";
export { updateCustomField } from "./updateCustomField";
export { deleteCustomField } from "./deleteCustomField";

// Per-value config CRUD (dropdown/multi_select options, boolean rows)
export { createCustomFieldValue } from "./createCustomFieldValue";
export { updateCustomFieldValue } from "./updateCustomFieldValue";
export { deleteCustomFieldValue } from "./deleteCustomFieldValue";

// Groups + memberships
export { createCustomFieldGroup } from "./createCustomFieldGroup";
export { updateCustomFieldGroup } from "./updateCustomFieldGroup";
export { deleteCustomFieldGroup } from "./deleteCustomFieldGroup";
export { addFieldToGroup } from "./addFieldToGroup";
export { removeFieldFromGroup } from "./removeFieldFromGroup";

// Bindings (where fields/groups apply)
export { createCustomFieldBinding } from "./createCustomFieldBinding";
export { updateCustomFieldBinding } from "./updateCustomFieldBinding";
export { deleteCustomFieldBinding } from "./deleteCustomFieldBinding";

// Product-editor convenience binding creator
export { createBindingForProductScope } from "./createBindingForProductScope";
