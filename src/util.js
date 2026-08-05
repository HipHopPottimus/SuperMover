function isObject(item) {
    return (item && typeof item === 'object' && !Array.isArray(item));
}

function deepMerge(target, source) {
    let output = Object.assign({}, target);
    if (isObject(target) && isObject(source)) {
        Object.keys(source).forEach(key => {
            if (isObject(source[key])) {
                if (!(key in target)) {
                    Object.assign(output, { [key]: source[key] });
                }
                else {
                    output[key] = deepMerge(target[key], source[key]);
                }
            }
            else if (Array.isArray(source[key])) {
                output[key] = source[key];
            }
            else {
                Object.assign(output, { [key]: source[key] });
            }
        });
    }
    return output;
}

function createRisingEdgeTrigger(maxTimeout) {
    let timeout = 0;
    return (condition, callback) => {
        if(!timeout && condition) {
            timeout = maxTimeout;
            callback();
        }
        if(timeout && !condition) {
            timeout -= 1;
        }
    }
}

export { isObject, deepMerge, createRisingEdgeTrigger }
