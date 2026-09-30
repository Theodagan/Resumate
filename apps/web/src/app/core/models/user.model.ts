export interface User {
  id: string;
  firstName: string;
  lastName: string;
  linkedin?: string;
  github?: string;
  website?: string;
  email?: string;
  phone?: string;
  profilePicture?: string;
  coverPicture?: string;
  mcpCvEnabled?: boolean;
  mcpMaterialsEnabled?: boolean;
}
