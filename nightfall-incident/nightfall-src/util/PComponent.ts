import React from "react";

class PComponent<P, S> extends React.Component<P, S> {
  setState<K extends keyof S>(...args: any) {
    throw new Error("PComponent can only run functional setStateP");
  }
  setStateP<K extends keyof S>(
    ssFunc: (prevState: Readonly<S>, props: Readonly<P>) => Pick<S, K> | S | null
  ): Promise<void> {
    return new Promise((resolve) => {
      super.setState(ssFunc, resolve);
    });
  }
}

export default PComponent;
