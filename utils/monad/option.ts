interface IOption<T> {
	isSome(): boolean;
	isNone(): boolean;
	unwrap(): T | never;
	unwrapOr(defaultValue: T): T;
	map<M>(fn: (v: T) => M): IOption<M>;
}

export abstract class Option<T> implements IOption<T> {
	public static Some<T>(value: T): SomeOption<T> {
		return new SomeOption(value);
	}
	public static None<T>(): NoneOption<T> {
		return new NoneOption();
	}

	public static from<T>(value: T | undefined | null): IOption<T> {
		if (!value) return new NoneOption();
		return new SomeOption(value);
	}

	abstract isSome(): boolean;
	abstract isNone(): boolean;
	abstract unwrap(): T | never;
	abstract unwrapOr(defaultValue: T): T;
	abstract map<M>(fn: (v: T) => M): IOption<M>;
}

export class SomeOption<T> extends Option<T> {
	constructor(private readonly value: T) {
		super();
	}

	isSome(): boolean {
		return true;
	}
	isNone(): boolean {
		return false;
	}
	unwrap(): T | never {
		return this.value;
	}
	unwrapOr(_: T): T {
		return this.value;
	}
	map<M>(fn: (v: T) => M): IOption<M> {
		return Option.from(fn(this.value));
	}
}

export class NoneOption<T> extends Option<T> {
	constructor() {
		super();
	}

	isSome(): boolean {
		return false;
	}
	isNone(): boolean {
		return true;
	}
	unwrap(): T | never {
		throw new ReferenceError("Cannot unwrap None");
	}
	unwrapOr(defaultValue: T): T {
		return defaultValue;
	}
	map<M>(_: (v: T) => M): IOption<M> {
		return Option.None<M>();
	}
}
