export interface Permission {
  id: string;
  name: string;
  resource: string;
  action: string;
  description: string | null;
  created_at: string;
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface RolePermission {
  role_id: string;
  permission_id: string;
  created_at: string;
}

export interface UserRole {
  user_id: string;
  role_id: string;
  assigned_by: string | null;
  assigned_at: string;
}

export interface UserRoleWithName extends UserRole {
  role_name: string;
}
