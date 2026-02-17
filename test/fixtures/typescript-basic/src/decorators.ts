// Decorator test fixtures

// Simple decorator factory
function Route(path: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    return descriptor;
  };
}

function Auth(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
  return descriptor;
}

function Controller(name: string) {
  return function (target: any) {
    return target;
  };
}

@Controller('users')
export class UserController {
  @Route('/users')
  getUsers(): string[] {
    return this.fetchFromDB();
  }

  @Route('/users/:id')
  @Auth
  getUser(id: string): string {
    return this.fetchFromDB()[0];
  }

  private fetchFromDB(): string[] {
    return ['user1', 'user2'];
  }
}

// Standalone decorated function
export function helperFunction(): void {
  // not decorated
}
