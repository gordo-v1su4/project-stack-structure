import "next-auth";

declare module "next-auth" {
  interface User {
    id: string;
    login?: string;
  }

  interface Session {
    user: User;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    ownerId?: string;
    login?: string;
  }
}
